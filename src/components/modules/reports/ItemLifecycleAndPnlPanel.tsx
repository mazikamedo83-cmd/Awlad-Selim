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

const fmt = (n: number | undefined | null) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n: number | undefined | null) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });

export const ItemLifecycleAndPnlPanel: React.FC<ItemLifecycleAndPnlPanelProps> = ({
  lifecycle,
  selectedPnl,
  pnlItems,
  portfolioTotals,
  currency,
  onSelectProduct,
  onInspectDocument,
}) => {
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
    <div className="space-y-2.5" dir="rtl">
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
              تاريخ الصنف من أول يوم لآخر حركة ({lifecycle.timeline.length})
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
              تحليل الأرباح والخسائر التفصيلي للصنف
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
            أرباح وخسائر جميع الأصناف ({pnlItems.length})
          </button>
        </div>

        {lifecycle && (
          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
            <span>الصنف: <strong className="text-slate-900">{lifecycle.product.name}</strong></span>
            <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">كود: {lifecycle.product.code}</span>
            {lifecycle.product.barcode && (
              <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">باركود: {lifecycle.product.barcode}</span>
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
                      المجموعة: <strong>{lifecycle.product.category}</strong> · تصنيف 1: <strong>{lifecycle.product.class1 || 'بدون'}</strong> · الوحدة الأساسية: <strong>{lifecycle.product.baseUnit}</strong>
                    </p>
                  </div>
                </div>
                <div className="text-left text-[11px] text-slate-500">
                  <span className="flex items-center gap-1 justify-end">
                    <Calendar className="w-3 h-3" />
                    تاريخ إضافة الصنف:
                  </span>
                  <strong className="text-slate-800 font-mono">{lifecycle.product.createdAtFormatted || '-'}</strong>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden text-xs">
                <div className="px-2.5 py-1.5 bg-slate-50">
                  <span className="text-[11px] text-slate-500 block">الرصيد الحالي الكلي</span>
                  <strong className="text-sm font-black text-slate-900 tabular-nums">{fmtQty(lifecycle.currentStockTotal)} {lifecycle.product.baseUnit}</strong>
                </div>
                <div className="px-2.5 py-1.5 bg-slate-50">
                  <span className="text-[11px] text-slate-500 block">قيمة المخزون بالتكلفة</span>
                  <strong className="text-sm font-black text-blue-800 tabular-nums">{fmt(lifecycle.currentStockValueAtCost)} {currency}</strong>
                </div>
                <div className="px-2.5 py-1.5 bg-slate-50">
                  <span className="text-[11px] text-slate-500 block">آخر سعر شراء</span>
                  <strong className="text-sm font-black text-amber-700 tabular-nums">{fmt(lifecycle.lastPurchasePrice)}</strong>
                  {lifecycle.lastPurchaseDate && <span className="block text-[10px] text-slate-400 font-mono">{lifecycle.lastPurchaseDate}</span>}
                </div>
                <div className="px-2.5 py-1.5 bg-slate-50">
                  <span className="text-[11px] text-slate-500 block">آخر سعر بيع</span>
                  <strong className="text-sm font-black text-emerald-700 tabular-nums">{fmt(lifecycle.lastSalePrice)}</strong>
                  {lifecycle.lastSaleDate && <span className="block text-[10px] text-slate-400 font-mono">{lifecycle.lastSaleDate}</span>}
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-slate-800 mb-1.5">
                <WarehouseIcon className="w-3.5 h-3.5 text-blue-700" />
                <span>الرصيد الحالي حسب المخزن والعهد</span>
              </div>
              <div className="max-h-36 overflow-y-auto border border-slate-200 rounded-md">
                <table className="w-full text-right text-xs border-collapse">
                  <thead className="bg-slate-100 text-slate-700 text-[10px] sticky top-0">
                    <tr>
                      <th className="px-2 py-1 border-b border-slate-200">المخزن / الفرع</th>
                      <th className="px-2 py-1 border-b border-slate-200 text-left">الرصيد</th>
                      <th className="px-2 py-1 border-b border-slate-200 text-left">التكلفة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lifecycle.warehouseBalances.map((wb) => (
                      <tr key={wb.warehouseId} className="hover:bg-slate-50">
                        <td className="px-2 py-1">
                          <strong className="text-slate-800 block">{wb.warehouseName}</strong>
                          <span className="text-[10px] text-slate-500">{wb.branchName}</span>
                        </td>
                        <td className="px-2 py-1 text-left font-mono tabular-nums">
                          <strong className={wb.quantity > 0 ? 'text-emerald-700' : wb.quantity < 0 ? 'text-rose-700' : 'text-slate-500'}>
                            {fmtQty(wb.quantity)}
                          </strong>
                        </td>
                        <td className="px-2 py-1 text-left font-mono text-[11px] text-slate-500 tabular-nums">
                          {fmt(wb.costValue)} {currency}
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
            title="السجل التاريخي التسلسلي الكامل للصنف (من لحظة الإضافة حتى آخر حركة)"
            subtitle={`عدد الأحداث: ${lifecycle.timeline.length}`}
            compact
            maxHeightClassName="max-h-[52vh]"
            data={lifecycle.timeline}
            rowKey={(ev) => ev.id}
            searchPlaceholder="بحث بالمستند أو نوع الحركة أو المخزن أو الطرف..."
            exportFilename={`AWLAD_SELIM_Lifecycle_${lifecycle.product.code}`}
            pdfTitle={`السجل التاريخي للصنف: ${lifecycle.product.name}`}
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
                header: 'اليومية',
                sortable: true,
                sortValue: (ev) => ev.date,
                exportValue: (ev) => ev.date.replace(/-/g, '/'),
                render: (ev) => <span className="font-mono whitespace-nowrap tabular-nums">{ev.date.replace(/-/g, '/')}</span>,
              },
              {
                key: 'actualDateTime',
                header: 'التاريخ الفعلي',
                sortable: true,
                sortValue: (ev) => ev.actualDateTime,
                exportValue: (ev) => ev.actualDateTime,
                render: (ev) => <span className="font-mono whitespace-nowrap text-[11px] tabular-nums">{ev.actualDateTime}</span>,
              },
              {
                key: 'eventLabel',
                header: 'نوع الحركة',
                sortable: true,
                sortValue: (ev) => ev.eventLabel,
                exportValue: (ev) => ev.eventLabel,
                render: (ev) => <span className="font-bold whitespace-nowrap">{ev.eventLabel}</span>,
              },
              {
                key: 'docNumber',
                header: 'رقم المستند',
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
                header: 'المخزن / المسار',
                sortable: true,
                sortValue: (ev) => ev.warehouseName,
                exportValue: (ev) => ev.warehouseName,
                render: (ev) => <span className="whitespace-nowrap">{ev.warehouseName}</span>,
              },
              {
                key: 'partyName',
                header: 'الطرف',
                sortable: true,
                sortValue: (ev) => ev.partyName,
                exportValue: (ev) => ev.partyName,
                render: (ev) => <span className="whitespace-nowrap">{ev.partyName}</span>,
              },
              {
                key: 'unit',
                header: 'الوحدة',
                align: 'center',
                exportValue: (ev) => ev.unit,
                render: (ev) => <span className="whitespace-nowrap">{ev.unit}</span>,
              },
              {
                key: 'qtyIn',
                header: 'وارد (+)',
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
                header: 'صادر (-)',
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
                header: 'الرصيد بعد الحركة',
                align: 'center',
                sortable: true,
                sortValue: (ev) => ev.runningBalance,
                exportValue: (ev) => ev.runningBalance,
                cellClassName: 'bg-slate-50 font-mono font-black text-slate-900 tabular-nums',
                render: (ev) => <span>{fmtQty(ev.runningBalance)}</span>,
              },
              {
                key: 'unitPrice',
                header: 'السعر / التكلفة',
                align: 'center',
                sortable: true,
                sortValue: (ev) => ev.unitPrice,
                exportValue: (ev) => ev.unitPrice,
                render: (ev) => <span className="font-mono tabular-nums">{fmt(ev.unitPrice)}</span>,
              },
              {
                key: 'totalValue',
                header: 'الإجمالي',
                align: 'center',
                sortable: true,
                sortValue: (ev) => ev.totalValue,
                exportValue: (ev) => ev.totalValue,
                render: (ev) => <span className="font-mono font-bold tabular-nums">{fmt(ev.totalValue)}</span>,
              },
              {
                key: 'userName',
                header: 'المستخدم',
                sortable: true,
                sortValue: (ev) => ev.userName,
                exportValue: (ev) => ev.userName,
                render: (ev) => <span className="whitespace-nowrap">{ev.userName}</span>,
              },
              {
                key: 'notes',
                header: 'ملاحظات',
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
              <span className="text-[11px] text-slate-500 block">إجمالي المشتريات</span>
              <strong className="text-sm font-black text-slate-900 tabular-nums">{fmt(selectedPnl.totalPurchaseValue)} {currency}</strong>
              <span className="text-[10px] text-slate-500 block">الكمية: {fmtQty(selectedPnl.totalPurchaseQty)} {selectedPnl.baseUnit}</span>
            </div>
            <div className="px-2.5 py-2 bg-white">
              <span className="text-[11px] text-slate-500 block">صافي المبيعات</span>
              <strong className="text-sm font-black text-blue-800 tabular-nums">{fmt(selectedPnl.netSalesValue)} {currency}</strong>
              <span className="text-[10px] text-slate-500 block">صافي الكمية: {fmtQty(selectedPnl.netSalesQty)} (خصم: {fmt(selectedPnl.totalDiscounts)})</span>
            </div>
            <div className="px-2.5 py-2 bg-white">
              <span className="text-[11px] text-slate-500 block">تكلفة البضاعة المباعة</span>
              <strong className="text-sm font-black text-amber-800 tabular-nums">{fmt(selectedPnl.cogs)} {currency}</strong>
              <span className="text-[10px] text-slate-500 block">مرتجع بيع: {fmt(selectedPnl.salesReturnsValue)}</span>
            </div>
            <div className="px-2.5 py-2 bg-white">
              <span className="text-[11px] text-slate-500 block">مجمل الربح</span>
              <strong className={`text-sm font-black tabular-nums ${selectedPnl.grossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {fmt(selectedPnl.grossProfit)} {currency}
              </strong>
              <span className="text-[10px] text-slate-500 block">مرتجع شراء: {fmt(selectedPnl.purchaseReturnsValue)}</span>
            </div>
            <div className="px-2.5 py-2 bg-emerald-50/40">
              <span className="text-[11px] text-slate-600 block">صافي الربح</span>
              <strong className={`text-sm font-black flex items-center gap-1 tabular-nums ${selectedPnl.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {selectedPnl.netProfit >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {fmt(selectedPnl.netProfit)} {currency}
              </strong>
              <span className="text-[10px] text-slate-600 block">نسبة على التكلفة: {selectedPnl.profitPercentOnCost}% | هامش: {selectedPnl.profitMarginOnSales}%</span>
            </div>
            <div className="px-2.5 py-2 bg-rose-50/40">
              <span className="text-[11px] text-slate-600 block">إجمالي الخسائر والتوالف</span>
              <strong className="text-sm font-black text-rose-700 tabular-nums">{fmt(selectedPnl.totalLoss)} {currency}</strong>
              <span className="text-[10px] text-slate-500 block">مصاريف/توالف محملة: {fmt(selectedPnl.allocatedExpenses)}</span>
            </div>
            <div className="px-2.5 py-1.5 col-span-2 sm:col-span-4 lg:col-span-6 grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50">
              <div>
                <span className="text-[11px] text-slate-500 block">عدد الوحدات المتبقية</span>
                <strong className="text-xs font-black text-slate-900 tabular-nums">{fmtQty(selectedPnl.currentStockQty)} {selectedPnl.baseUnit}</strong>
              </div>
              <div>
                <span className="text-[11px] text-slate-500 block">قيمة المخزون الحالي</span>
                <strong className="text-xs font-black text-blue-800 tabular-nums">{fmt(selectedPnl.currentStockValue)} {currency}</strong>
              </div>
              <div>
                <span className="text-[11px] text-slate-500 block">إجمالي المبيعات (قبل المرتجع)</span>
                <strong className="text-xs font-black text-slate-900 tabular-nums">{fmt(selectedPnl.totalSalesValue)} {currency} ({fmtQty(selectedPnl.totalSalesQty)})</strong>
              </div>
              <div>
                <span className="text-[11px] text-slate-500 block">صافي المشتريات (بعد المرتجع)</span>
                <strong className="text-xs font-black text-slate-900 tabular-nums">{fmt(selectedPnl.netPurchaseValue)} {currency} ({fmtQty(selectedPnl.netPurchaseQty)})</strong>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
            <div className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-1.5">
              <h4 className="font-extrabold text-slate-800 border-b border-slate-100 pb-1">تحليل أسعار الشراء ({selectedPnl.baseUnit})</h4>
              <div className="grid grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded overflow-hidden text-center">
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">المتوسط</span><strong className="font-mono tabular-nums">{fmt(selectedPnl.avgPurchasePrice)}</strong></div>
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">الأقل</span><strong className="font-mono text-emerald-700 tabular-nums">{fmt(selectedPnl.minPurchasePrice)}</strong></div>
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">الأعلى</span><strong className="font-mono text-rose-700 tabular-nums">{fmt(selectedPnl.maxPurchasePrice)}</strong></div>
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">الآخر</span><strong className="font-mono tabular-nums">{fmt(selectedPnl.lastPurchasePrice)}</strong></div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-1.5">
              <h4 className="font-extrabold text-slate-800 border-b border-slate-100 pb-1">تحليل أسعار البيع ({selectedPnl.baseUnit})</h4>
              <div className="grid grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded overflow-hidden text-center">
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">المتوسط</span><strong className="font-mono tabular-nums">{fmt(selectedPnl.avgSalePrice)}</strong></div>
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">الأقل</span><strong className="font-mono text-rose-700 tabular-nums">{fmt(selectedPnl.minSalePrice)}</strong></div>
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">الأعلى</span><strong className="font-mono text-emerald-700 tabular-nums">{fmt(selectedPnl.maxSalePrice)}</strong></div>
                <div className="p-1.5 bg-slate-50"><span className="text-[11px] text-slate-500 block">الآخر</span><strong className="font-mono tabular-nums">{fmt(selectedPnl.lastSalePrice)}</strong></div>
              </div>
            </div>
          </div>

          {/* Loss-making sales & damaged breakdown */}
          <UnifiedDataTable
            title={`الحركات الخاسرة والبيع بأقل من التكلفة (${selectedPnl.lossTransactions.length})`}
            subtitle={`إجمالي الخسائر: ${fmt(selectedPnl.totalLoss)} ${currency}`}
            compact
            searchable={false}
            data={selectedPnl.lossTransactions}
            rowKey={(lt) => lt.id}
            onRowClick={(lt) => onInspectDocument(lt.docType, lt.docId)}
            rowClassName={() => 'cursor-pointer hover:bg-rose-50/70'}
            exportFilename={`AWLAD_SELIM_LossTransactions_${selectedPnl.code}`}
            pdfTitle={`الحركات الخاسرة للصنف: ${selectedPnl.productName}`}
            emptyTitle="لا توجد أي عمليات بيع خاسرة أو توالف لهذا الصنف ضمن الفترة المحددة"
            columns={[
              {
                key: 'actualDateTime',
                header: 'التاريخ الفعلي',
                sortable: true,
                sortValue: (lt) => lt.actualDateTime,
                exportValue: (lt) => lt.actualDateTime,
                render: (lt) => <span className="font-mono text-[11px] tabular-nums">{lt.actualDateTime}</span>,
              },
              {
                key: 'docNumber',
                header: 'المستند',
                sortable: true,
                sortValue: (lt) => lt.docNumber,
                exportValue: (lt) => lt.docNumber,
                render: (lt) => <span className="font-mono text-blue-700 font-bold">{lt.docNumber}</span>,
              },
              {
                key: 'partyName',
                header: 'العميل / المخزن',
                sortable: true,
                sortValue: (lt) => lt.partyName,
                exportValue: (lt) => lt.partyName,
                render: (lt) => <span>{lt.partyName}</span>,
              },
              {
                key: 'quantity',
                header: 'الكمية',
                align: 'center',
                sortable: true,
                sortValue: (lt) => lt.quantity,
                exportValue: (lt) => `${lt.quantity} ${lt.unit}`,
                render: (lt) => <span className="font-bold tabular-nums">{lt.quantity} {lt.unit}</span>,
              },
              {
                key: 'sellingPrice',
                header: 'سعر البيع',
                align: 'center',
                sortable: true,
                sortValue: (lt) => lt.sellingPrice,
                exportValue: (lt) => lt.sellingPrice,
                render: (lt) => <span className="font-mono tabular-nums">{fmt(lt.sellingPrice)}</span>,
              },
              {
                key: 'costPrice',
                header: 'التكلفة',
                align: 'center',
                sortable: true,
                sortValue: (lt) => lt.costPrice,
                exportValue: (lt) => lt.costPrice,
                render: (lt) => <span className="font-mono tabular-nums">{fmt(lt.costPrice)}</span>,
              },
              {
                key: 'discount',
                header: 'الخصم',
                align: 'center',
                sortable: true,
                sortValue: (lt) => lt.discount,
                exportValue: (lt) => lt.discount,
                render: (lt) => <span className="font-mono text-amber-700 tabular-nums">{fmt(lt.discount)}</span>,
              },
              {
                key: 'lossAmount',
                header: 'قيمة الخسارة',
                align: 'center',
                sortable: true,
                sortValue: (lt) => lt.lossAmount,
                exportValue: (lt) => -lt.lossAmount,
                render: (lt) => <span className="font-mono font-black text-rose-700 tabular-nums">-{fmt(lt.lossAmount)}</span>,
              },
              {
                key: 'reason',
                header: 'السبب التفصيلي',
                exportValue: (lt) => lt.reason,
                render: (lt) => <span className="text-rose-900">{lt.reason}</span>,
              },
            ]}
          />
        </div>
      )}

      {/* 3. Portfolio P&L Overview across All Products */}
      {(innerTab === 'portfolio' || (!lifecycle && !selectedPnl)) && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden text-xs">
            <div className="px-2.5 py-2 bg-white"><span className="text-[11px] text-slate-500 block">إجمالي المشتريات</span><strong className="text-sm font-black tabular-nums">{fmt(portfolioTotals.totalPurchaseValue)}</strong></div>
            <div className="px-2.5 py-2 bg-white"><span className="text-[11px] text-slate-500 block">صافي المبيعات</span><strong className="text-sm font-black text-blue-800 tabular-nums">{fmt(portfolioTotals.netSalesValue)}</strong></div>
            <div className="px-2.5 py-2 bg-white"><span className="text-[11px] text-slate-500 block">تكلفة البضاعة المباعة</span><strong className="text-sm font-black text-amber-800 tabular-nums">{fmt(portfolioTotals.cogs)}</strong></div>
            <div className="px-2.5 py-2 bg-white"><span className="text-[11px] text-slate-500 block">صافي الربح</span><strong className={`text-sm font-black tabular-nums ${portfolioTotals.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(portfolioTotals.netProfit)}</strong></div>
            <div className="px-2.5 py-2 bg-white"><span className="text-[11px] text-slate-500 block">إجمالي الخسائر</span><strong className="text-sm font-black text-rose-700 tabular-nums">{fmt(portfolioTotals.totalLoss)}</strong></div>
            <div className="px-2.5 py-2 bg-white"><span className="text-[11px] text-slate-500 block">قيمة المخزون الحالي</span><strong className="text-sm font-black text-slate-900 tabular-nums">{fmt(portfolioTotals.stockValuation)}</strong></div>
          </div>

          <UnifiedDataTable<ItemPnlSummary>
            title="تحليل أرباح وخسائر الأصناف"
            subtitle="اضغط على أي صنف لفتح تاريخه الكامل من أول يوم"
            compact
            maxHeightClassName="max-h-[54vh]"
            data={filteredPortfolio}
            rowKey={(item) => item.productId}
            searchValue={portfolioSearch}
            onSearchChange={setPortfolioSearch}
            searchPlaceholder="بحث باسم الصنف أو الكود..."
            exportFilename="AWLAD_SELIM_ItemsPnL"
            pdfTitle="تحليل أرباح وخسائر جميع الأصناف"
            defaultPageSize={50}
            onRowClick={(item) => {
              onSelectProduct(item.productId);
              setInnerTab('timeline');
            }}
            rowClassName={() => 'cursor-pointer hover:bg-blue-50/70'}
            columns={[
              {
                key: 'productName',
                header: 'الصنف',
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
                header: 'المجموعة',
                sortable: true,
                sortValue: (it) => it.category,
                exportValue: (it) => it.category,
                render: (it) => <span>{it.category}</span>,
              },
              {
                key: 'totalPurchaseValue',
                header: 'مشتريات',
                align: 'center',
                sortable: true,
                sortValue: (it) => it.totalPurchaseValue,
                exportValue: (it) => it.totalPurchaseValue,
                render: (it) => <span className="font-mono tabular-nums">{fmt(it.totalPurchaseValue)}</span>,
              },
              {
                key: 'netSalesValue',
                header: 'صافي المبيعات',
                align: 'center',
                sortable: true,
                sortValue: (it) => it.netSalesValue,
                exportValue: (it) => it.netSalesValue,
                render: (it) => <span className="font-mono font-bold text-blue-800 tabular-nums">{fmt(it.netSalesValue)}</span>,
              },
              {
                key: 'cogs',
                header: 'تكلفة البضاعة المباعة',
                align: 'center',
                sortable: true,
                sortValue: (it) => it.cogs,
                exportValue: (it) => it.cogs,
                render: (it) => <span className="font-mono tabular-nums">{fmt(it.cogs)}</span>,
              },
              {
                key: 'totalDiscounts',
                header: 'الخصومات',
                align: 'center',
                sortable: true,
                sortValue: (it) => it.totalDiscounts,
                exportValue: (it) => it.totalDiscounts,
                render: (it) => <span className="font-mono text-amber-700 tabular-nums">{fmt(it.totalDiscounts)}</span>,
              },
              {
                key: 'salesReturnsValue',
                header: 'مرتجعات بيع',
                align: 'center',
                sortable: true,
                sortValue: (it) => it.salesReturnsValue,
                exportValue: (it) => it.salesReturnsValue,
                render: (it) => <span className="font-mono text-rose-700 tabular-nums">{fmt(it.salesReturnsValue)}</span>,
              },
              {
                key: 'allocatedExpenses',
                header: 'التوالف / المصاريف',
                align: 'center',
                sortable: true,
                sortValue: (it) => it.allocatedExpenses,
                exportValue: (it) => it.allocatedExpenses,
                render: (it) => <span className="font-mono text-rose-700 tabular-nums">{fmt(it.allocatedExpenses)}</span>,
              },
              {
                key: 'netProfit',
                header: 'صافي الربح',
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
                header: 'نسبة الربح على التكلفة',
                align: 'center',
                sortable: true,
                sortValue: (it) => it.profitPercentOnCost,
                exportValue: (it) => `${it.profitPercentOnCost}%`,
                render: (it) => <span className="font-mono tabular-nums">{it.profitPercentOnCost}%</span>,
              },
              {
                key: 'profitMarginOnSales',
                header: 'هامش المبيعات',
                align: 'center',
                sortable: true,
                sortValue: (it) => it.profitMarginOnSales,
                exportValue: (it) => `${it.profitMarginOnSales}%`,
                render: (it) => <span className="font-mono tabular-nums">{it.profitMarginOnSales}%</span>,
              },
              {
                key: 'totalLoss',
                header: 'الخسائر',
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
                header: 'المخزون الحالي',
                align: 'center',
                sortable: true,
                sortValue: (it) => it.currentStockQty,
                exportValue: (it) => `${it.currentStockQty} ${it.baseUnit}`,
                render: (it) => <span className="font-mono font-bold tabular-nums">{fmtQty(it.currentStockQty)} {it.baseUnit}</span>,
              },
              {
                key: 'currentStockValue',
                header: 'قيمة المخزون',
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

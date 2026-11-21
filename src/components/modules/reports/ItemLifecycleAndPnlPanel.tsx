import React, { useState, useEffect } from 'react';
import {
  Package,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Warehouse as WarehouseIcon,
  Calendar,
  ExternalLink,
  Search,
} from 'lucide-react';
import type { ItemLifecyclePayload, ItemPnlSummary } from '../../../types';

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
    <div className="space-y-4" dir="rtl">
      {/* Sub-mode switcher inside the unified Item Analysis view */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl p-2.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {lifecycle && (
            <button
              type="button"
              onClick={() => setInnerTab('timeline')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-colors cursor-pointer ${
                innerTab === 'timeline'
                  ? 'bg-emerald-700 text-white shadow-xs'
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
              className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-colors cursor-pointer ${
                innerTab === 'pnl'
                  ? 'bg-blue-700 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              تحليل الأرباح والخسائر التفصيلي للصنف
            </button>
          )}
          <button
            type="button"
            onClick={() => setInnerTab('portfolio')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-extrabold transition-colors cursor-pointer ${
              innerTab === 'portfolio' || (!lifecycle && !selectedPnl)
                ? 'bg-slate-800 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            أرباح وخسائر جميع الأصناف ({pnlItems.length})
          </button>
        </div>

        {lifecycle && (
          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-3">
            <span>الصنف: <strong className="text-slate-900">{lifecycle.product.name}</strong></span>
            <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">كود: {lifecycle.product.code}</span>
            {lifecycle.product.barcode && (
              <span className="font-mono bg-slate-100 px-2 py-0.5 rounded">باركود: {lifecycle.product.barcode}</span>
            )}
          </div>
        )}
      </div>

      {/* 1. Selected Item Full Lifecycle History */}
      {lifecycle && innerTab === 'timeline' && (
        <div className="space-y-4">
          {/* Product Header & Warehouse Stock Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                    <Package className="w-5 h-5 text-emerald-700" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900 text-base">{lifecycle.product.name}</h3>
                    <p className="text-xs text-slate-500">
                      المجموعة: <strong>{lifecycle.product.category}</strong> · تصنيف 1: <strong>{lifecycle.product.class1 || 'بدون'}</strong> · الوحدة الأساسية: <strong>{lifecycle.product.baseUnit}</strong>
                    </p>
                  </div>
                </div>
                <div className="text-left text-[11px] text-slate-500">
                  <span className="flex items-center gap-1 justify-end">
                    <Calendar className="w-3.5 h-3.5" />
                    تاريخ إضافة الصنف:
                  </span>
                  <strong className="text-slate-800 font-mono">{lifecycle.product.createdAtFormatted || '-'}</strong>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">الرصيد الحالي الكلي</span>
                  <strong className="text-base font-black text-slate-900">{fmtQty(lifecycle.currentStockTotal)} {lifecycle.product.baseUnit}</strong>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">قيمة المخزون بالتكلفة</span>
                  <strong className="text-base font-black text-blue-800">{fmt(lifecycle.currentStockValueAtCost)} {currency}</strong>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">آخر سعر شراء</span>
                  <strong className="text-base font-black text-amber-700">{fmt(lifecycle.lastPurchasePrice)}</strong>
                  {lifecycle.lastPurchaseDate && <span className="block text-[10px] text-slate-400 font-mono">{lifecycle.lastPurchaseDate}</span>}
                </div>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block">آخر سعر بيع</span>
                  <strong className="text-base font-black text-emerald-700">{fmt(lifecycle.lastSalePrice)}</strong>
                  {lifecycle.lastSaleDate && <span className="block text-[10px] text-slate-400 font-mono">{lifecycle.lastSaleDate}</span>}
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs">
              <div className="flex items-center gap-2 text-xs font-extrabold text-slate-800 mb-2.5">
                <WarehouseIcon className="w-4 h-4 text-blue-700" />
                <span>الرصيد الحالي حسب المخزن والعهد</span>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto text-xs">
                {lifecycle.warehouseBalances.map((wb) => (
                  <div key={wb.warehouseId} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                    <div>
                      <strong className="text-slate-800 block">{wb.warehouseName}</strong>
                      <span className="text-[10px] text-slate-500">{wb.branchName}</span>
                    </div>
                    <div className="text-left font-mono">
                      <strong className={wb.quantity > 0 ? 'text-emerald-700' : wb.quantity < 0 ? 'text-rose-700' : 'text-slate-500'}>
                        {fmtQty(wb.quantity)}
                      </strong>
                      <span className="block text-[10px] text-slate-400">{fmt(wb.costValue)} {currency}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Chronological Timeline Table */}
          <div className="bg-white border border-slate-300 rounded-xl overflow-hidden shadow-2xs">
            <div className="bg-[#5f6f52] text-white px-4 py-2 text-xs font-extrabold flex items-center justify-between">
              <span>السجل التاريخي التسلسلي الكامل للصنف (من لحظة الإضافة حتى آخر حركة)</span>
              <span>عدد الأحداث: {lifecycle.timeline.length}</span>
            </div>
            <div className="overflow-auto max-h-[52vh]">
              <table className="w-full text-right text-xs border-collapse min-w-[1150px]">
                <thead className="bg-slate-100 text-slate-800 sticky top-0 z-10 border-b border-slate-300">
                  <tr>
                    <th className="p-2 border-l border-slate-200 whitespace-nowrap">اليومية</th>
                    <th className="p-2 border-l border-slate-200 whitespace-nowrap">التاريخ الفعلى</th>
                    <th className="p-2 border-l border-slate-200 whitespace-nowrap">نوع الحركة</th>
                    <th className="p-2 border-l border-slate-200 whitespace-nowrap">رقم المستند</th>
                    <th className="p-2 border-l border-slate-200 whitespace-nowrap">المخزن / المسار</th>
                    <th className="p-2 border-l border-slate-200 whitespace-nowrap">الطرف</th>
                    <th className="p-2 border-l border-slate-200 whitespace-nowrap text-center">الوحدة</th>
                    <th className="p-2 border-l border-slate-200 whitespace-nowrap text-center">وارد (+)</th>
                    <th className="p-2 border-l border-slate-200 whitespace-nowrap text-center">صادر (-)</th>
                    <th className="p-2 border-l border-slate-200 whitespace-nowrap text-center">الرصيد بعد الحركة</th>
                    <th className="p-2 border-l border-slate-200 whitespace-nowrap text-center">السعر / التكلفة</th>
                    <th className="p-2 border-l border-slate-200 whitespace-nowrap text-center">الإجمالي</th>
                    <th className="p-2 border-l border-slate-200 whitespace-nowrap">المستخدم</th>
                    <th className="p-2 whitespace-nowrap">ملاحظات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {lifecycle.timeline.map((ev) => {
                    const isPriceChg = ev.eventType === 'price_change' || ev.eventType === 'product_updated';
                    const isDamaged = ev.eventType === 'damaged' || ev.eventType === 'custody_damaged';
                    return (
                      <tr
                        key={ev.id}
                        onClick={() => {
                          if (ev.docId && ev.docType !== 'product' && ev.docType !== 'audit') {
                            onInspectDocument(ev.docType, ev.docId);
                          }
                        }}
                        className={`transition-colors ${
                          ev.docType !== 'product' && ev.docType !== 'audit' ? 'cursor-pointer hover:bg-blue-50/70' : ''
                        } ${isPriceChg ? 'bg-amber-50/70' : isDamaged ? 'bg-rose-50/70' : 'bg-white'}`}
                      >
                        <td className="p-2 border-l border-slate-200 font-mono whitespace-nowrap">{ev.date.replace(/-/g, '/')}</td>
                        <td className="p-2 border-l border-slate-200 font-mono whitespace-nowrap text-[11px]">{ev.actualDateTime}</td>
                        <td className="p-2 border-l border-slate-200 font-bold whitespace-nowrap">{ev.eventLabel}</td>
                        <td className="p-2 border-l border-slate-200 font-mono whitespace-nowrap text-blue-700">
                          <span className="inline-flex items-center gap-1">
                            {ev.docNumber}
                            {ev.docType !== 'product' && ev.docType !== 'audit' && <ExternalLink className="w-3 h-3" />}
                          </span>
                        </td>
                        <td className="p-2 border-l border-slate-200 whitespace-nowrap">{ev.warehouseName}</td>
                        <td className="p-2 border-l border-slate-200 whitespace-nowrap">{ev.partyName}</td>
                        <td className="p-2 border-l border-slate-200 text-center whitespace-nowrap">{ev.unit}</td>
                        <td className="p-2 border-l border-slate-200 text-center font-mono font-bold text-emerald-700">
                          {ev.qtyIn > 0 ? `+${fmtQty(ev.qtyIn)}` : '-'}
                        </td>
                        <td className="p-2 border-l border-slate-200 text-center font-mono font-bold text-rose-700">
                          {ev.qtyOut > 0 ? `-${fmtQty(ev.qtyOut)}` : '-'}
                        </td>
                        <td className="p-2 border-l border-slate-200 text-center font-mono font-black bg-slate-50 text-slate-900">
                          {fmtQty(ev.runningBalance)}
                        </td>
                        <td className="p-2 border-l border-slate-200 text-center font-mono">{fmt(ev.unitPrice)}</td>
                        <td className="p-2 border-l border-slate-200 text-center font-mono font-bold">{fmt(ev.totalValue)}</td>
                        <td className="p-2 border-l border-slate-200 whitespace-nowrap">{ev.userName}</td>
                        <td className="p-2 text-slate-600 whitespace-nowrap">{ev.notes || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 2. Selected Item Detailed Profit & Loss Analysis */}
      {selectedPnl && innerTab === 'pnl' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs">
            <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-2xs">
              <span className="text-slate-500 block">إجمالي المشتريات</span>
              <strong className="text-base font-black text-slate-900">{fmt(selectedPnl.totalPurchaseValue)} {currency}</strong>
              <span className="text-[11px] text-slate-500 block">الكمية: {fmtQty(selectedPnl.totalPurchaseQty)} {selectedPnl.baseUnit}</span>
            </div>
            <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-2xs">
              <span className="text-slate-500 block">صافي المبيعات</span>
              <strong className="text-base font-black text-blue-800">{fmt(selectedPnl.netSalesValue)} {currency}</strong>
              <span className="text-[11px] text-slate-500 block">صافي الكمية: {fmtQty(selectedPnl.netSalesQty)} (خصم: {fmt(selectedPnl.totalDiscounts)})</span>
            </div>
            <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-2xs">
              <span className="text-slate-500 block">تكلفة البضاعة المباعة (COGS)</span>
              <strong className="text-base font-black text-amber-800">{fmt(selectedPnl.cogs)} {currency}</strong>
              <span className="text-[11px] text-slate-500 block">مرتجع بيع: {fmt(selectedPnl.salesReturnsValue)}</span>
            </div>
            <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-2xs">
              <span className="text-slate-500 block">مجمل الربح</span>
              <strong className={`text-base font-black ${selectedPnl.grossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {fmt(selectedPnl.grossProfit)} {currency}
              </strong>
              <span className="text-[11px] text-slate-500 block">مرتجع شراء: {fmt(selectedPnl.purchaseReturnsValue)}</span>
            </div>
            <div className="p-3 bg-white border border-emerald-300 rounded-xl shadow-2xs bg-emerald-50/40">
              <span className="text-slate-600 block">صافي الربح</span>
              <strong className={`text-base font-black flex items-center gap-1 ${selectedPnl.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {selectedPnl.netProfit >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {fmt(selectedPnl.netProfit)} {currency}
              </strong>
              <span className="text-[11px] text-slate-600 block">نسبة على التكلفة: {selectedPnl.profitPercentOnCost}% | هامش: {selectedPnl.profitMarginOnSales}%</span>
            </div>
            <div className="p-3 bg-white border border-rose-200 rounded-xl shadow-2xs bg-rose-50/40">
              <span className="text-slate-600 block">إجمالي الخسائر والتوالف</span>
              <strong className="text-base font-black text-rose-700">{fmt(selectedPnl.totalLoss)} {currency}</strong>
              <span className="text-[11px] text-slate-500 block">مصاريف/توالف محملة: {fmt(selectedPnl.allocatedExpenses)}</span>
            </div>
            <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-2xs col-span-2 sm:col-span-4 lg:col-span-6 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50/60">
              <div>
                <span className="text-slate-500 block">عدد الوحدات المتبقية</span>
                <strong className="text-sm font-black text-slate-900">{fmtQty(selectedPnl.currentStockQty)} {selectedPnl.baseUnit}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">قيمة المخزون الحالي</span>
                <strong className="text-sm font-black text-blue-800">{fmt(selectedPnl.currentStockValue)} {currency}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">إجمالي المبيعات (قبل المرتجع)</span>
                <strong className="text-sm font-black text-slate-900">{fmt(selectedPnl.totalSalesValue)} {currency} ({fmtQty(selectedPnl.totalSalesQty)})</strong>
              </div>
              <div>
                <span className="text-slate-500 block">صافي المشتريات (بعد المرتجع)</span>
                <strong className="text-sm font-black text-slate-900">{fmt(selectedPnl.netPurchaseValue)} {currency} ({fmtQty(selectedPnl.netPurchaseQty)})</strong>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <h4 className="font-extrabold text-slate-800 border-b border-slate-100 pb-2">تحليل أسعار الشراء ({selectedPnl.baseUnit})</h4>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2 rounded bg-slate-50"><span className="text-slate-500 block">المتوسط</span><strong className="font-mono">{fmt(selectedPnl.avgPurchasePrice)}</strong></div>
                <div className="p-2 rounded bg-slate-50"><span className="text-slate-500 block">الأقل</span><strong className="font-mono text-emerald-700">{fmt(selectedPnl.minPurchasePrice)}</strong></div>
                <div className="p-2 rounded bg-slate-50"><span className="text-slate-500 block">الأعلى</span><strong className="font-mono text-rose-700">{fmt(selectedPnl.maxPurchasePrice)}</strong></div>
                <div className="p-2 rounded bg-slate-50"><span className="text-slate-500 block">الآخر</span><strong className="font-mono">{fmt(selectedPnl.lastPurchasePrice)}</strong></div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <h4 className="font-extrabold text-slate-800 border-b border-slate-100 pb-2">تحليل أسعار البيع ({selectedPnl.baseUnit})</h4>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2 rounded bg-slate-50"><span className="text-slate-500 block">المتوسط</span><strong className="font-mono">{fmt(selectedPnl.avgSalePrice)}</strong></div>
                <div className="p-2 rounded bg-slate-50"><span className="text-slate-500 block">الأقل</span><strong className="font-mono text-rose-700">{fmt(selectedPnl.minSalePrice)}</strong></div>
                <div className="p-2 rounded bg-slate-50"><span className="text-slate-500 block">الأعلى</span><strong className="font-mono text-emerald-700">{fmt(selectedPnl.maxSalePrice)}</strong></div>
                <div className="p-2 rounded bg-slate-50"><span className="text-slate-500 block">الآخر</span><strong className="font-mono">{fmt(selectedPnl.lastSalePrice)}</strong></div>
              </div>
            </div>
          </div>

          {/* Loss-making sales & damaged breakdown */}
          <div className="bg-white border border-rose-200 rounded-xl overflow-hidden">
            <div className="bg-rose-700 text-white px-4 py-2 text-xs font-extrabold flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                الحركات الخاسرة والبيع بأقل من التكلفة ({selectedPnl.lossTransactions.length})
              </span>
              <span>إجمالي الخسائر: {fmt(selectedPnl.totalLoss)} {currency}</span>
            </div>
            {selectedPnl.lossTransactions.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 font-bold">لا توجد أي عمليات بيع خاسرة أو توالف لهذا الصنف ضمن الفترة المحددة.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs border-collapse">
                  <thead className="bg-rose-50 text-rose-950 border-b border-rose-200">
                    <tr>
                      <th className="p-2">التاريخ الفعلى</th>
                      <th className="p-2">المستند</th>
                      <th className="p-2">العميل / المخزن</th>
                      <th className="p-2 text-center">الكمية</th>
                      <th className="p-2 text-center">سعر البيع</th>
                      <th className="p-2 text-center">التكلفة</th>
                      <th className="p-2 text-center">الخصم</th>
                      <th className="p-2 text-center">قيمة الخسارة</th>
                      <th className="p-2">السبب التفصيلي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rose-100">
                    {selectedPnl.lossTransactions.map((lt) => (
                      <tr
                        key={lt.id}
                        onClick={() => onInspectDocument(lt.docType, lt.docId)}
                        className="hover:bg-rose-50/70 cursor-pointer"
                      >
                        <td className="p-2 font-mono text-[11px]">{lt.actualDateTime}</td>
                        <td className="p-2 font-mono text-blue-700 font-bold">{lt.docNumber}</td>
                        <td className="p-2">{lt.partyName}</td>
                        <td className="p-2 text-center font-bold">{lt.quantity} {lt.unit}</td>
                        <td className="p-2 text-center font-mono">{fmt(lt.sellingPrice)}</td>
                        <td className="p-2 text-center font-mono">{fmt(lt.costPrice)}</td>
                        <td className="p-2 text-center font-mono text-amber-700">{fmt(lt.discount)}</td>
                        <td className="p-2 text-center font-mono font-black text-rose-700">-{fmt(lt.lossAmount)}</td>
                        <td className="p-2 text-rose-900">{lt.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Portfolio P&L Overview across All Products */}
      {(innerTab === 'portfolio' || (!lifecycle && !selectedPnl)) && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
            <div className="p-3 bg-white border border-slate-200 rounded-xl"><span className="text-slate-500 block">إجمالي المشتريات</span><strong className="text-sm font-black">{fmt(portfolioTotals.totalPurchaseValue)}</strong></div>
            <div className="p-3 bg-white border border-slate-200 rounded-xl"><span className="text-slate-500 block">صافي المبيعات</span><strong className="text-sm font-black text-blue-800">{fmt(portfolioTotals.netSalesValue)}</strong></div>
            <div className="p-3 bg-white border border-slate-200 rounded-xl"><span className="text-slate-500 block">تكلفة البضاعة المباعة</span><strong className="text-sm font-black text-amber-800">{fmt(portfolioTotals.cogs)}</strong></div>
            <div className="p-3 bg-white border border-slate-200 rounded-xl"><span className="text-slate-500 block">صافي الربح</span><strong className={`text-sm font-black ${portfolioTotals.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{fmt(portfolioTotals.netProfit)}</strong></div>
            <div className="p-3 bg-white border border-slate-200 rounded-xl"><span className="text-slate-500 block">إجمالي الخسائر</span><strong className="text-sm font-black text-rose-700">{fmt(portfolioTotals.totalLoss)}</strong></div>
            <div className="p-3 bg-white border border-slate-200 rounded-xl"><span className="text-slate-500 block">قيمة المخزون الحالي</span><strong className="text-sm font-black text-slate-900">{fmt(portfolioTotals.stockValuation)}</strong></div>
          </div>

          <div className="bg-white border border-slate-300 rounded-xl overflow-hidden shadow-2xs">
            <div className="bg-slate-800 text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-extrabold">تحليل أرباح وخسائر الأصناف (اضغط على أي صنف لفتح تاريخه الكامل من أول يوم)</span>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2" />
                <input
                  type="text"
                  value={portfolioSearch}
                  onChange={(e) => setPortfolioSearch(e.target.value)}
                  placeholder="بحث باسم الصنف أو الكود..."
                  className="bg-slate-700 text-white placeholder-slate-400 pr-8 pl-2.5 py-1 rounded-lg text-xs border border-slate-600 focus:outline-none"
                />
              </div>
            </div>
            <div className="overflow-auto max-h-[54vh]">
              <table className="w-full text-right text-xs border-collapse min-w-[1300px]">
                <thead className="bg-slate-100 text-slate-800 sticky top-0 z-10 border-b border-slate-300">
                  <tr>
                    <th className="p-2 border-l border-slate-200">الصنف</th>
                    <th className="p-2 border-l border-slate-200">المجموعة</th>
                    <th className="p-2 border-l border-slate-200 text-center">مشتريات</th>
                    <th className="p-2 border-l border-slate-200 text-center">صافي المبيعات</th>
                    <th className="p-2 border-l border-slate-200 text-center">COGS</th>
                    <th className="p-2 border-l border-slate-200 text-center">الخصومات</th>
                    <th className="p-2 border-l border-slate-200 text-center">مرتجعات بيع</th>
                    <th className="p-2 border-l border-slate-200 text-center">التوالف / المصاريف</th>
                    <th className="p-2 border-l border-slate-200 text-center">صافي الربح</th>
                    <th className="p-2 border-l border-slate-200 text-center">نسبة الربح على التكلفة</th>
                    <th className="p-2 border-l border-slate-200 text-center">هامش المبيعات</th>
                    <th className="p-2 border-l border-slate-200 text-center">الخسائر</th>
                    <th className="p-2 border-l border-slate-200 text-center">المخزون الحالي</th>
                    <th className="p-2 text-center">قيمة المخزون</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredPortfolio.map((item) => (
                    <tr
                      key={item.productId}
                      onClick={() => {
                        onSelectProduct(item.productId);
                        setInnerTab('timeline');
                      }}
                      className="hover:bg-blue-50/70 cursor-pointer transition-colors"
                    >
                      <td className="p-2 border-l border-slate-200 font-bold text-slate-900">
                        {item.productName}
                        <span className="block text-[10px] text-slate-500 font-mono">{item.code}</span>
                      </td>
                      <td className="p-2 border-l border-slate-200">{item.category}</td>
                      <td className="p-2 border-l border-slate-200 text-center font-mono">{fmt(item.totalPurchaseValue)}</td>
                      <td className="p-2 border-l border-slate-200 text-center font-mono font-bold text-blue-800">{fmt(item.netSalesValue)}</td>
                      <td className="p-2 border-l border-slate-200 text-center font-mono">{fmt(item.cogs)}</td>
                      <td className="p-2 border-l border-slate-200 text-center font-mono text-amber-700">{fmt(item.totalDiscounts)}</td>
                      <td className="p-2 border-l border-slate-200 text-center font-mono text-rose-700">{fmt(item.salesReturnsValue)}</td>
                      <td className="p-2 border-l border-slate-200 text-center font-mono text-rose-700">{fmt(item.allocatedExpenses)}</td>
                      <td className={`p-2 border-l border-slate-200 text-center font-mono font-black ${item.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {fmt(item.netProfit)}
                      </td>
                      <td className="p-2 border-l border-slate-200 text-center font-mono">{item.profitPercentOnCost}%</td>
                      <td className="p-2 border-l border-slate-200 text-center font-mono">{item.profitMarginOnSales}%</td>
                      <td className="p-2 border-l border-slate-200 text-center font-mono text-rose-700">{item.totalLoss > 0 ? fmt(item.totalLoss) : '-'}</td>
                      <td className="p-2 border-l border-slate-200 text-center font-mono font-bold">{fmtQty(item.currentStockQty)} {item.baseUnit}</td>
                      <td className="p-2 text-center font-mono">{fmt(item.currentStockValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

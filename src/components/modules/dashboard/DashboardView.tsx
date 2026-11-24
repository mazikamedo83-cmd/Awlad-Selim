import React, { useState, useMemo } from 'react';
import {
  AlertTriangle, ArrowLeftRight, Calendar, ChevronLeft, Eye
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { NavItemKey } from '../../layout/Sidebar';

interface DashboardViewProps {
  onNavigate: (page: NavItemKey) => void;
  onViewInvoice?: (invoiceId: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const {
    invoices, products, customers, suppliers, cashboxes,
    repTransfers, expenseIncomes, settings,
  } = useData();
  const { currentUser } = useAuth();

  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | '7days' | 'thisMonth' | 'prevMonth' | 'thisYear'>('thisMonth');

  const formatYMD = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // Filter calculations based on date filter
  const dateRange = useMemo(() => {
    const now = new Date();
    let startDate = new Date();
    let endDate = new Date();

    if (dateFilter === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (dateFilter === 'yesterday') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
    } else if (dateFilter === '7days') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    } else if (dateFilter === 'thisMonth') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (dateFilter === 'prevMonth') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    } else if (dateFilter === 'thisYear') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }

    return {
      startStr: formatYMD(startDate),
      endStr: formatYMD(endDate),
    };
  }, [dateFilter]);

  const todayStr = formatYMD(new Date());

  const isWithinPeriod = (dateStr?: string) => {
    if (!dateStr) return false;
    const day = dateStr.slice(0, 10);
    return day >= dateRange.startStr && day <= dateRange.endStr;
  };

  // Sales totals
  const confirmedSales = invoices.filter(i => i.type === 'sales' && i.status === 'confirmed');
  const periodSales = confirmedSales.filter(i => isWithinPeriod(i.date));
  const totalSales = periodSales.reduce((acc, i) => acc + i.grandTotal, 0);
  const todaySales = confirmedSales.filter(i => (i.date || '').slice(0, 10) === todayStr).reduce((acc, i) => acc + i.grandTotal, 0);

  // Purchases totals
  const confirmedPurchases = invoices.filter(i => i.type === 'purchase' && i.status === 'confirmed');
  const periodPurchases = confirmedPurchases.filter(i => isWithinPeriod(i.date));
  const totalPurchases = periodPurchases.reduce((acc, i) => acc + i.grandTotal, 0);
  const todayPurchases = confirmedPurchases.filter(i => (i.date || '').slice(0, 10) === todayStr).reduce((acc, i) => acc + i.grandTotal, 0);

  // Expenses & Income (within selected period)
  const periodExpensesIncome = expenseIncomes.filter(e => isWithinPeriod(e.date));
  const totalExpenses = periodExpensesIncome.filter(e => e.type === 'expense').reduce((acc, e) => acc + e.amount, 0);
  const totalIncome = periodExpensesIncome.filter(e => e.type === 'income').reduce((acc, e) => acc + e.amount, 0);

  // Real last-7-days chart aggregation from confirmed invoices
  const last7DaysChart = useMemo(() => {
    const arabicDays = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const buckets: Array<{ day: string; dateStr: string; sales: number; purchases: number }> = [];
    const now = new Date();
    for (let offset = 6; offset >= 0; offset--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      const dStr = formatYMD(d);
      const daySales = confirmedSales
        .filter(i => (i.date || '').slice(0, 10) === dStr)
        .reduce((sum, i) => sum + i.grandTotal, 0);
      const dayPurchases = confirmedPurchases
        .filter(i => (i.date || '').slice(0, 10) === dStr)
        .reduce((sum, i) => sum + i.grandTotal, 0);
      buckets.push({
        day: offset === 0 ? 'اليوم' : arabicDays[d.getDay()],
        dateStr: dStr,
        sales: daySales,
        purchases: dayPurchases,
      });
    }
    const maxVal = Math.max(1000, ...buckets.map(b => Math.max(b.sales, b.purchases)));
    return { buckets, maxVal };
  }, [confirmedSales, confirmedPurchases]);

  // Cashbox total
  const totalCashAndBanks = cashboxes.reduce((acc, c) => acc + (c.currentBalance ?? 0), 0);

  // Debts
  const customerDebtsTotal = customers.reduce((acc, c) => acc + (c.currentBalance > 0 ? c.currentBalance : 0), 0);
  const supplierDebtsTotal = suppliers.reduce((acc, s) => acc + (s.currentBalance > 0 ? s.currentBalance : 0), 0);

  // Inventory value & low stock alerts
  const inventoryValue = products.reduce((acc, prod) => {
    const totalQty = Object.values(prod.stockPerWarehouse || {}).reduce((q, v) => q + v, 0);
    return acc + (totalQty * prod.purchasePrice);
  }, 0);

  const lowStockProducts = products.filter(prod => {
    if (prod.status === 'archived') return false;
    const totalQty = Object.values(prod.stockPerWarehouse || {}).reduce((q, v) => q + v, 0);
    return totalQty <= prod.minStockLevel;
  });

  // Pending transfers count ("طلب تحويل بالنصف")
  const pendingTransfers = repTransfers.filter(t => t.status === 'awaiting_receipt');

  return (
    <div className="space-y-4">
      {/* Compact Header & Period Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white px-4 py-3 rounded-lg border border-slate-200">
        <div>
          <h2 className="text-base font-black text-slate-900 flex flex-wrap items-center gap-2">
            <span>ملخص الحسابات — {currentUser?.fullName}</span>
            {currentUser?.jobTitle && (
              <span className="text-[11px] font-bold text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                {currentUser.jobTitle}
              </span>
            )}
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {settings.companyName || 'أولاد سليم'} • {new Date().toLocaleDateString('ar-EG')}
          </p>
        </div>

        <div className="flex items-center gap-2 bg-slate-50 px-2.5 py-1.5 rounded-md border border-slate-200 text-xs">
          <Calendar className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-slate-600 font-bold">الفترة:</span>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as any)}
            className="bg-white border border-slate-300 rounded px-2 py-1 text-xs font-bold text-slate-800 focus:outline-hidden focus:border-blue-600"
          >
            <option value="today">اليوم</option>
            <option value="yesterday">أمس</option>
            <option value="7days">آخر 7 أيام</option>
            <option value="thisMonth">الشهر الحالي</option>
            <option value="prevMonth">الشهر السابق</option>
            <option value="thisYear">السنة المالية الحالية</option>
          </select>
        </div>
      </div>

      {/* Operational Alerts Strip */}
      {(pendingTransfers.length > 0 || lowStockProducts.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {pendingTransfers.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('rep-transfers')}
              className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-950 text-right hover:bg-amber-100/70 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <ArrowLeftRight className="w-4 h-4 text-amber-700 shrink-0" />
                <div>
                  <div className="text-xs font-black">
                    {pendingTransfers.length} طلب تحويل بالنصف بانتظار تأكيد الاستلام
                  </div>
                  <div className="text-[11px] text-amber-800">
                    فتح شاشة التحويلات لمراجعة وتأكيد الاستلام
                  </div>
                </div>
              </div>
              <ChevronLeft className="w-4 h-4 text-amber-700 shrink-0" />
            </button>
          )}

          {lowStockProducts.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('products')}
              className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-950 text-right hover:bg-red-100/70 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-700 shrink-0" />
                <div>
                  <div className="text-xs font-black">
                    تنبيه مخزون: {lowStockProducts.length} أصناف عند أو دون حد الطلب الأدنى
                  </div>
                  <div className="text-[11px] text-red-800">
                    مراجعة الأصناف الناقصة في دليل المخزون
                  </div>
                </div>
              </div>
              <ChevronLeft className="w-4 h-4 text-red-700 shrink-0" />
            </button>
          )}
        </div>
      )}

      {/* Accounting Summary Ledger Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-white px-3.5 py-3">
          <div className="text-[11px] font-bold text-slate-500">إجمالي المبيعات</div>
          <div className="text-base font-black text-slate-900 tabular-nums mt-0.5">
            {totalSales.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="text-[11px] text-emerald-700 font-bold tabular-nums mt-1">
            اليوم: {todaySales.toLocaleString()} {settings.currency}
          </div>
        </div>

        <div className="bg-white px-3.5 py-3">
          <div className="text-[11px] font-bold text-slate-500">إجمالي المشتريات</div>
          <div className="text-base font-black text-slate-900 tabular-nums mt-0.5">
            {totalPurchases.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="text-[11px] text-indigo-700 font-bold tabular-nums mt-1">
            اليوم: {todayPurchases.toLocaleString()} {settings.currency}
          </div>
        </div>

        <div
          onClick={() => onNavigate('cashboxes')}
          className="bg-white px-3.5 py-3 hover:bg-slate-50 cursor-pointer transition-colors"
        >
          <div className="text-[11px] font-bold text-slate-500">أرصدة الخزائن والبنوك</div>
          <div className="text-base font-black text-emerald-700 tabular-nums mt-0.5">
            {totalCashAndBanks.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium mt-1">
            {cashboxes.length} خزائن وحسابات نشطة
          </div>
        </div>

        <div
          onClick={() => onNavigate('products')}
          className="bg-white px-3.5 py-3 hover:bg-slate-50 cursor-pointer transition-colors"
        >
          <div className="text-[11px] font-bold text-slate-500">قيمة المخزون (تكلفة)</div>
          <div className="text-base font-black text-slate-900 tabular-nums mt-0.5">
            {inventoryValue.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium mt-1">
            {products.length} صنف مسجل
          </div>
        </div>

        <div
          onClick={() => onNavigate('customer-accounts')}
          className="bg-white px-3.5 py-3 hover:bg-slate-50 cursor-pointer transition-colors"
        >
          <div className="text-[11px] font-bold text-slate-500">مديونيات العملاء</div>
          <div className="text-base font-black text-rose-700 tabular-nums mt-0.5">
            {customerDebtsTotal.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium mt-1">
            من أصل {customers.length} عميل
          </div>
        </div>

        <div
          onClick={() => onNavigate('supplier-accounts')}
          className="bg-white px-3.5 py-3 hover:bg-slate-50 cursor-pointer transition-colors"
        >
          <div className="text-[11px] font-bold text-slate-500">مستحقات الموردين</div>
          <div className="text-base font-black text-purple-700 tabular-nums mt-0.5">
            {supplierDebtsTotal.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium mt-1">
            من أصل {suppliers.length} مورد
          </div>
        </div>

        <div
          onClick={() => onNavigate('expenses')}
          className="bg-white px-3.5 py-3 hover:bg-slate-50 cursor-pointer transition-colors"
        >
          <div className="text-[11px] font-bold text-slate-500">المصروفات</div>
          <div className="text-base font-black text-orange-700 tabular-nums mt-0.5">
            {totalExpenses.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium mt-1">
            خلال الفترة المحددة
          </div>
        </div>

        <div
          onClick={() => onNavigate('expenses')}
          className="bg-white px-3.5 py-3 hover:bg-slate-50 cursor-pointer transition-colors"
        >
          <div className="text-[11px] font-bold text-slate-500">الإيرادات المتنوعة</div>
          <div className="text-base font-black text-teal-700 tabular-nums mt-0.5">
            {totalIncome.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium mt-1">
            خلال الفترة المحددة
          </div>
        </div>
      </div>

      {/* Activity Chart & Cashboxes Ledger Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white p-4 rounded-lg border border-slate-200 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-xs font-black text-slate-900">حركة المبيعات والمشتريات (آخر 7 أيام)</h3>
            <div className="flex items-center gap-3 text-[11px] font-bold">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-xs bg-blue-600"></span> المبيعات</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-xs bg-slate-300"></span> المشتريات</span>
            </div>
          </div>

          <div className="h-44 pt-4 flex items-end justify-between gap-2 border-b border-slate-200">
            {last7DaysChart.buckets.map((d, idx) => {
              const salesH = d.sales > 0 ? Math.max(4, Math.min(100, (d.sales / last7DaysChart.maxVal) * 100)) : 0;
              const purH = d.purchases > 0 ? Math.max(4, Math.min(100, (d.purchases / last7DaysChart.maxVal) * 100)) : 0;

              return (
                <div key={d.dateStr || idx} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <div className="flex items-end gap-1 w-full justify-center h-full">
                    <div
                      style={{ height: `${salesH}%` }}
                      className="w-4 sm:w-5 bg-blue-600 rounded-t-xs hover:bg-blue-700 transition-colors"
                      title={`${d.dateStr} — مبيعات: ${d.sales.toLocaleString()} ${settings.currency}`}
                    />
                    <div
                      style={{ height: `${purH}%` }}
                      className="w-4 sm:w-5 bg-slate-300 rounded-t-xs hover:bg-slate-400 transition-colors"
                      title={`${d.dateStr} — مشتريات: ${d.purchases.toLocaleString()} ${settings.currency}`}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 mt-1">{d.day}</span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-end text-xs">
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-blue-700 font-bold hover:underline flex items-center gap-1 cursor-pointer"
            >
              تقرير المبيعات والأرباح المفصل <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Cashboxes Ledger Table */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden flex flex-col">
          <div className="px-3.5 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h3 className="text-xs font-black text-slate-900">أرصدة الخزائن والبنوك</h3>
            <button
              type="button"
              onClick={() => onNavigate('cashboxes')}
              className="text-[11px] text-blue-700 font-bold hover:underline cursor-pointer"
            >
              إدارة الخزائن
            </button>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50/70 text-slate-600 font-bold border-b border-slate-200">
                  <th className="px-3 py-2">الحساب / الخزينة</th>
                  <th className="px-3 py-2 text-left">الرصيد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cashboxes.map(cb => (
                  <tr key={cb.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <div className="font-bold text-slate-800">{cb.name}</div>
                      <div className="text-[10px] text-slate-500">
                        {cb.type === 'bank' ? `بنك: ${cb.accountNumber || 'جاري'}` : 'خزينة نقدية'}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-left font-black text-blue-950 tabular-nums whitespace-nowrap">
                      {cb.balanceHidden ? 'مخفي' : (cb.currentBalance ?? 0).toLocaleString()}{' '}
                      <span className="text-[10px] font-normal text-slate-500">{settings.currency}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Recent Invoices Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-black text-slate-900">أحدث الفواتير المسجلة</h3>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('sales-invoices')}
            className="text-xs text-blue-700 font-bold hover:underline flex items-center gap-1 cursor-pointer"
          >
            عرض جميع الفواتير <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <th className="px-3 py-2">رقم الفاتورة</th>
                <th className="px-3 py-2">النوع</th>
                <th className="px-3 py-2">العميل / المورد</th>
                <th className="px-3 py-2">التاريخ</th>
                <th className="px-3 py-2">المستودع</th>
                <th className="px-3 py-2">الإجمالي</th>
                <th className="px-3 py-2">المدفوع</th>
                <th className="px-3 py-2">المتبقي</th>
                <th className="px-3 py-2">الحالة</th>
                <th className="px-3 py-2 text-center">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.slice(0, 8).map(inv => (
                <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-3 py-2 font-bold text-blue-900 font-mono whitespace-nowrap">{inv.invoiceNumber}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {inv.type === 'sales' ? (
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 text-[10px] font-bold">مبيعات</span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200 text-[10px] font-bold">مشتريات</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-semibold text-slate-800">
                    {inv.customerName || inv.supplierName || 'نقدي / عام'}
                  </td>
                  <td className="px-3 py-2 text-slate-500 font-mono whitespace-nowrap">{inv.date}</td>
                  <td className="px-3 py-2 text-slate-600">{inv.warehouseName}</td>
                  <td className="px-3 py-2 font-black text-slate-900 tabular-nums whitespace-nowrap">{inv.grandTotal.toLocaleString()} {settings.currency}</td>
                  <td className="px-3 py-2 font-bold text-emerald-700 tabular-nums whitespace-nowrap">{inv.paidAmount.toLocaleString()}</td>
                  <td className="px-3 py-2 font-bold text-red-600 tabular-nums whitespace-nowrap">{inv.remainingAmount.toLocaleString()}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {inv.status === 'confirmed' ? (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                        مؤكدة
                      </span>
                    ) : inv.status === 'draft' ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">
                        مسودة
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold">
                        ملغاة
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (inv.type === 'sales') {
                          onNavigate('sales-invoices');
                        } else {
                          onNavigate('purchase-invoices');
                        }
                      }}
                      className="p-1 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50 transition-colors cursor-pointer"
                      title="عرض الفاتورة"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

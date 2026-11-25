import React, { useState, useMemo } from 'react';
import {
  AlertTriangle, ArrowLeftRight, Calendar, ChevronLeft, Eye, EyeOff
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { DashboardBalanceGroup, usePreferences } from '../../../context/PreferencesContext';
import { NavItemKey } from '../../layout/Sidebar';
import { UnifiedColumn, UnifiedDataTable } from '../../common/UnifiedDataTable';
import { Cashbox, Invoice } from '../../../types';

interface DashboardViewProps {
  onNavigate: (page: NavItemKey) => void;
  onViewInvoice?: (invoiceId: string) => void;
}

const MASKED_AMOUNT = '••••••';

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const {
    invoices, products, customers, suppliers, cashboxes,
    repTransfers, expenseIncomes, settings,
  } = useData();
  const { currentUser } = useAuth();
  const {
    isDashboardGroupHidden,
    toggleDashboardGroupVisibility,
    areAllDashboardBalancesHidden,
    toggleAllDashboardBalances,
  } = usePreferences();

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

  const renderMaskEyeButton = (group: DashboardBalanceGroup, label: string) => {
    const hidden = isDashboardGroupHidden(group);
    return (
      <button
        type="button"
        data-testid={`eye-toggle-${group}`}
        aria-pressed={hidden}
        aria-label={hidden ? `إظهار ${label}` : `إخفاء ${label}`}
        title={hidden ? 'إظهار الرصيد' : 'إخفاء الرصيد'}
        onClick={(e) => {
          e.stopPropagation();
          toggleDashboardGroupVisibility(group);
        }}
        className={`h-6 w-6 inline-flex items-center justify-center rounded border transition-colors cursor-pointer shrink-0 ${
          hidden
            ? 'bg-[#EEF3FA] dark:bg-[#16366B] text-[var(--awlad-royal-700)] dark:text-[#85B8FF] border-[#DCE6F5] dark:border-[#2E5CA8]'
            : 'bg-slate-50 dark:bg-[#132544] text-slate-500 dark:text-[#97AECE] border-slate-200 dark:border-[#21375C] hover:text-[var(--awlad-royal-700)] dark:hover:text-[#85B8FF] hover:border-[var(--awlad-royal-700)]/40'
        }`}
      >
        {hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
      </button>
    );
  };

  const salesHidden = isDashboardGroupHidden('sales');
  const purchasesHidden = isDashboardGroupHidden('purchases');
  const cashboxesHidden = isDashboardGroupHidden('cashboxes');
  const inventoryHidden = isDashboardGroupHidden('inventory');
  const customerDebtsHidden = isDashboardGroupHidden('customerDebts');
  const supplierDebtsHidden = isDashboardGroupHidden('supplierDebts');
  const expensesHidden = isDashboardGroupHidden('expenses');
  const incomeHidden = isDashboardGroupHidden('income');
  const chartHidden = isDashboardGroupHidden('chart');
  const cashboxTableHidden = isDashboardGroupHidden('cashboxTable');
  const recentInvoicesHidden = isDashboardGroupHidden('recentInvoices');

  return (
    <div className="space-y-2">
      {/* Compact Header, Privacy Toggle & Period Filter */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-[#0E1C36] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#21375C]">
        <div className="min-w-0">
          <h2 className="text-sm font-black text-[var(--awlad-navy-950)] dark:text-[#F3F7FC] flex flex-wrap items-center gap-1.5">
            <span>ملخص الحسابات — {currentUser?.fullName}</span>
            {currentUser?.jobTitle && (
              <span className="text-[11px] font-bold text-[var(--awlad-royal-700)] dark:text-[#85B8FF] bg-[#EEF3FA] dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#2A436E] px-1.5 py-0.5 rounded">
                {currentUser.jobTitle}
              </span>
            )}
          </h2>
          <p className="text-[11px] text-slate-500 dark:text-[#97AECE]">
            {settings.companyName || 'أولاد سليم'} • {new Date().toLocaleDateString('ar-EG')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="dashboard-toggle-all-balances"
            aria-pressed={areAllDashboardBalancesHidden}
            onClick={toggleAllDashboardBalances}
            className={`h-8 px-2.5 rounded-md border text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              areAllDashboardBalancesHidden
                ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white border-[var(--awlad-royal-700)] dark:border-[#3B82F6]'
                : 'bg-[#EEF3FA] dark:bg-[#132544] text-[var(--awlad-navy-950)] dark:text-[#DCE6F5] border-[#DCE6F5] dark:border-[#2A436E] hover:bg-[#DCE6F5] dark:hover:bg-[#1A3461]'
            }`}
          >
            {areAllDashboardBalancesHidden ? (
              <>
                <Eye className="w-3.5 h-3.5 shrink-0" />
                <span>إظهار جميع الأرصدة</span>
              </>
            ) : (
              <>
                <EyeOff className="w-3.5 h-3.5 shrink-0" />
                <span>إخفاء جميع الأرصدة</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-1.5 bg-[#EEF3FA] dark:bg-[#132544] px-2 h-8 rounded-md border border-[#DCE6F5] dark:border-[#2A436E] text-xs">
            <Calendar className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
            <span className="text-[var(--awlad-navy-950)] dark:text-[#DCE6F5] font-bold">الفترة:</span>
            <select
              aria-label="فترة ملخص الحسابات"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as any)}
              className="h-6 bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded px-1.5 text-xs font-bold text-slate-800 dark:text-[#EEF4FC] focus:outline-hidden focus:border-[var(--awlad-royal-700)] dark:focus:border-[#3B82F6]"
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
      </div>

      {/* Operational Alerts Strip */}
      {(pendingTransfers.length > 0 || lowStockProducts.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {pendingTransfers.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('rep-transfers')}
              className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/50 text-amber-950 dark:text-amber-100 text-right hover:bg-amber-100/70 dark:hover:bg-amber-900/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0" />
                <div>
                  <div className="text-xs font-black">
                    {pendingTransfers.length} طلب تحويل بالنصف بانتظار تأكيد الاستلام
                  </div>
                  <div className="text-[11px] text-amber-800 dark:text-amber-200/80">
                    فتح شاشة التحويلات لمراجعة وتأكيد الاستلام
                  </div>
                </div>
              </div>
              <ChevronLeft className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0" />
            </button>
          )}

          {lowStockProducts.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate('products')}
              className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-700/50 text-red-950 dark:text-red-100 text-right hover:bg-red-100/70 dark:hover:bg-red-900/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-700 dark:text-red-300 shrink-0" />
                <div>
                  <div className="text-xs font-black">
                    تنبيه مخزون: {lowStockProducts.length} أصناف عند أو دون حد الطلب الأدنى
                  </div>
                  <div className="text-[11px] text-red-800 dark:text-red-200/80">
                    مراجعة الأصناف الناقصة في دليل المخزون
                  </div>
                </div>
              </div>
              <ChevronLeft className="w-4 h-4 text-red-700 dark:text-red-300 shrink-0" />
            </button>
          )}
        </div>
      )}

      {/* Accounting Summary Ledger Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 dark:bg-[#21375C] border border-slate-200 dark:border-[#21375C] rounded-lg overflow-hidden">
        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-2" data-testid="kpi-card-sales">
          <div className="flex items-center justify-between gap-1">
            <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">إجمالي المبيعات</div>
            {renderMaskEyeButton('sales', 'إجمالي المبيعات')}
          </div>
          <div className="text-sm font-black text-[var(--awlad-navy-950)] dark:text-[#F3F7FC] tabular-nums mt-0.5" data-testid="kpi-val-sales">
            {salesHidden ? (
              <span className="tracking-widest text-slate-400 dark:text-[#85B8FF]">{MASKED_AMOUNT}</span>
            ) : (
              <>
                {totalSales.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500 dark:text-[#97AECE]">{settings.currency}</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-[var(--awlad-royal-700)] dark:text-[#85B8FF] font-bold tabular-nums mt-0.5">
            اليوم: {salesHidden ? MASKED_AMOUNT : `${todaySales.toLocaleString()} ${settings.currency}`}
          </div>
        </div>

        <div className="bg-white dark:bg-[#0E1C36] px-2.5 py-2" data-testid="kpi-card-purchases">
          <div className="flex items-center justify-between gap-1">
            <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">إجمالي المشتريات</div>
            {renderMaskEyeButton('purchases', 'إجمالي المشتريات')}
          </div>
          <div className="text-sm font-black text-[var(--awlad-navy-950)] dark:text-[#F3F7FC] tabular-nums mt-0.5" data-testid="kpi-val-purchases">
            {purchasesHidden ? (
              <span className="tracking-widest text-slate-400 dark:text-[#85B8FF]">{MASKED_AMOUNT}</span>
            ) : (
              <>
                {totalPurchases.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500 dark:text-[#97AECE]">{settings.currency}</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-[var(--awlad-silver-600)] dark:text-[#97AECE] font-bold tabular-nums mt-0.5">
            اليوم: {purchasesHidden ? MASKED_AMOUNT : `${todayPurchases.toLocaleString()} ${settings.currency}`}
          </div>
        </div>

        <div
          onClick={() => onNavigate('cashboxes')}
          className="bg-white dark:bg-[#0E1C36] px-2.5 py-2 hover:bg-[#EEF3FA]/50 dark:hover:bg-[#15284A] cursor-pointer transition-colors"
          data-testid="kpi-card-cashboxes"
        >
          <div className="flex items-center justify-between gap-1">
            <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">أرصدة الخزائن والبنوك</div>
            {renderMaskEyeButton('cashboxes', 'أرصدة الخزائن والبنوك')}
          </div>
          <div className="text-sm font-black text-[var(--awlad-royal-700)] dark:text-[#85B8FF] tabular-nums mt-0.5" data-testid="kpi-val-cashboxes">
            {cashboxesHidden ? (
              <span className="tracking-widest text-slate-400 dark:text-[#85B8FF]">{MASKED_AMOUNT}</span>
            ) : (
              <>
                {totalCashAndBanks.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500 dark:text-[#97AECE]">{settings.currency}</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-[#97AECE] font-medium mt-0.5">
            {cashboxes.length} خزائن وحسابات نشطة
          </div>
        </div>

        <div
          onClick={() => onNavigate('products')}
          className="bg-white dark:bg-[#0E1C36] px-2.5 py-2 hover:bg-[#EEF3FA]/50 dark:hover:bg-[#15284A] cursor-pointer transition-colors"
          data-testid="kpi-card-inventory"
        >
          <div className="flex items-center justify-between gap-1">
            <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">قيمة المخزون (تكلفة)</div>
            {renderMaskEyeButton('inventory', 'قيمة المخزون')}
          </div>
          <div className="text-sm font-black text-[var(--awlad-navy-950)] dark:text-[#F3F7FC] tabular-nums mt-0.5" data-testid="kpi-val-inventory">
            {inventoryHidden ? (
              <span className="tracking-widest text-slate-400 dark:text-[#85B8FF]">{MASKED_AMOUNT}</span>
            ) : (
              <>
                {inventoryValue.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500 dark:text-[#97AECE]">{settings.currency}</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-[#97AECE] font-medium mt-0.5">
            {products.length} صنف مسجل
          </div>
        </div>

        <div
          onClick={() => onNavigate('customer-accounts')}
          className="bg-white dark:bg-[#0E1C36] px-2.5 py-2 hover:bg-[#EEF3FA]/50 dark:hover:bg-[#15284A] cursor-pointer transition-colors"
          data-testid="kpi-card-customerDebts"
        >
          <div className="flex items-center justify-between gap-1">
            <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">مديونيات العملاء</div>
            {renderMaskEyeButton('customerDebts', 'مديونيات العملاء')}
          </div>
          <div className="text-sm font-black text-rose-700 dark:text-rose-400 tabular-nums mt-0.5" data-testid="kpi-val-customerDebts">
            {customerDebtsHidden ? (
              <span className="tracking-widest text-slate-400 dark:text-[#85B8FF]">{MASKED_AMOUNT}</span>
            ) : (
              <>
                {customerDebtsTotal.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500 dark:text-[#97AECE]">{settings.currency}</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-[#97AECE] font-medium mt-0.5">
            من أصل {customers.length} عميل
          </div>
        </div>

        <div
          onClick={() => onNavigate('supplier-accounts')}
          className="bg-white dark:bg-[#0E1C36] px-2.5 py-2 hover:bg-[#EEF3FA]/50 dark:hover:bg-[#15284A] cursor-pointer transition-colors"
          data-testid="kpi-card-supplierDebts"
        >
          <div className="flex items-center justify-between gap-1">
            <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">مستحقات الموردين</div>
            {renderMaskEyeButton('supplierDebts', 'مستحقات الموردين')}
          </div>
          <div className="text-sm font-black text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] tabular-nums mt-0.5" data-testid="kpi-val-supplierDebts">
            {supplierDebtsHidden ? (
              <span className="tracking-widest text-slate-400 dark:text-[#85B8FF]">{MASKED_AMOUNT}</span>
            ) : (
              <>
                {supplierDebtsTotal.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500 dark:text-[#97AECE]">{settings.currency}</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-[#97AECE] font-medium mt-0.5">
            من أصل {suppliers.length} مورد
          </div>
        </div>

        <div
          onClick={() => onNavigate('expenses')}
          className="bg-white dark:bg-[#0E1C36] px-2.5 py-2 hover:bg-[#EEF3FA]/50 dark:hover:bg-[#15284A] cursor-pointer transition-colors"
          data-testid="kpi-card-expenses"
        >
          <div className="flex items-center justify-between gap-1">
            <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">المصروفات</div>
            {renderMaskEyeButton('expenses', 'المصروفات')}
          </div>
          <div className="text-sm font-black text-[var(--awlad-silver-600)] dark:text-[#DCE6F5] tabular-nums mt-0.5" data-testid="kpi-val-expenses">
            {expensesHidden ? (
              <span className="tracking-widest text-slate-400 dark:text-[#85B8FF]">{MASKED_AMOUNT}</span>
            ) : (
              <>
                {totalExpenses.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500 dark:text-[#97AECE]">{settings.currency}</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-[#97AECE] font-medium mt-0.5">
            خلال الفترة المحددة
          </div>
        </div>

        <div
          onClick={() => onNavigate('expenses')}
          className="bg-white dark:bg-[#0E1C36] px-2.5 py-2 hover:bg-[#EEF3FA]/50 dark:hover:bg-[#15284A] cursor-pointer transition-colors"
          data-testid="kpi-card-income"
        >
          <div className="flex items-center justify-between gap-1">
            <div className="text-[11px] font-bold text-slate-500 dark:text-[#A9BCD9]">الإيرادات المتنوعة</div>
            {renderMaskEyeButton('income', 'الإيرادات المتنوعة')}
          </div>
          <div className="text-sm font-black text-[var(--awlad-royal-500)] dark:text-[#85B8FF] tabular-nums mt-0.5" data-testid="kpi-val-income">
            {incomeHidden ? (
              <span className="tracking-widest text-slate-400 dark:text-[#85B8FF]">{MASKED_AMOUNT}</span>
            ) : (
              <>
                {totalIncome.toLocaleString()} <span className="text-[11px] font-semibold text-slate-500 dark:text-[#97AECE]">{settings.currency}</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-[#97AECE] font-medium mt-0.5">
            خلال الفترة المحددة
          </div>
        </div>
      </div>

      {/* Activity Chart & Cashboxes Ledger Table (7/12 + 5/12 Desktop Balanced Grid) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
        <div
          className="lg:col-span-7 bg-white dark:bg-[#0E1C36] p-2.5 rounded-lg border border-slate-200 dark:border-[#21375C] flex flex-col justify-between space-y-2"
          data-testid="dashboard-chart-card"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-[#1B2F52] pb-1.5">
            <h3 className="text-xs font-black text-[var(--awlad-navy-950)] dark:text-[#F3F7FC]">
              حركة المبيعات والمشتريات (آخر 7 أيام)
            </h3>
            <div className="flex items-center gap-2.5 text-[11px] font-bold dark:text-[#DCE6F5]">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-xs bg-[var(--awlad-royal-700)] dark:bg-[#1D63D8]"></span> المبيعات
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-xs bg-[var(--awlad-silver-500)]/50 dark:bg-[#5E7BA8]"></span> المشتريات
              </span>
              {renderMaskEyeButton('chart', 'قيم الرسم البياني')}
            </div>
          </div>

          <div className="h-32 pt-2 flex items-end justify-between gap-2 border-b border-slate-200 dark:border-[#21375C]">
            {last7DaysChart.buckets.map((d, idx) => {
              const salesH = chartHidden
                ? 14
                : d.sales > 0
                ? Math.max(4, Math.min(100, (d.sales / last7DaysChart.maxVal) * 100))
                : 0;
              const purH = chartHidden
                ? 14
                : d.purchases > 0
                ? Math.max(4, Math.min(100, (d.purchases / last7DaysChart.maxVal) * 100))
                : 0;

              return (
                <div key={d.dateStr || idx} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                  <div className="flex items-end gap-1 w-full justify-center h-full">
                    <div
                      style={{ height: `${salesH}%` }}
                      className={
                        chartHidden
                          ? 'w-4 sm:w-5 bg-slate-200 dark:bg-[#1E3359] border border-dashed border-slate-300 dark:border-[#345183] rounded-t-xs transition-all'
                          : 'w-4 sm:w-5 bg-[var(--awlad-royal-700)] dark:bg-[#1D63D8] rounded-t-xs hover:bg-[var(--awlad-royal-500)] dark:hover:bg-[#3B82F6] transition-colors'
                      }
                      title={
                        chartHidden
                          ? `${d.dateStr} — مبيعات: ${MASKED_AMOUNT}`
                          : `${d.dateStr} — مبيعات: ${d.sales.toLocaleString()} ${settings.currency}`
                      }
                    />
                    <div
                      style={{ height: `${purH}%` }}
                      className={
                        chartHidden
                          ? 'w-4 sm:w-5 bg-slate-200/70 dark:bg-[#192B4D] border border-dashed border-slate-300 dark:border-[#345183] rounded-t-xs transition-all'
                          : 'w-4 sm:w-5 bg-[var(--awlad-silver-500)]/45 dark:bg-[#5E7BA8] rounded-t-xs hover:bg-[var(--awlad-silver-600)]/60 dark:hover:bg-[#7A98C6] transition-colors'
                      }
                      title={
                        chartHidden
                          ? `${d.dateStr} — مشتريات: ${MASKED_AMOUNT}`
                          : `${d.dateStr} — مشتريات: ${d.purchases.toLocaleString()} ${settings.currency}`
                      }
                    />
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 dark:text-[#97AECE] mt-1">{d.day}</span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-[#97AECE]">
              {chartHidden ? `ملخص آخر 7 أيام: ${MASKED_AMOUNT}` : `أعلى نشاط يومي: ${last7DaysChart.maxVal.toLocaleString()} ${settings.currency}`}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-[var(--awlad-royal-700)] dark:text-[#85B8FF] font-bold hover:underline flex items-center gap-1 cursor-pointer"
            >
              تقرير المبيعات والأرباح المفصل <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Cashboxes Ledger Table */}
        <div className="lg:col-span-5" data-testid="dashboard-cashboxes-table-card">
          <UnifiedDataTable<Cashbox>
            title="أرصدة الخزائن والبنوك"
            data={cashboxes}
            rowKey={(cb) => cb.id}
            searchable={false}
            compact
            paginated={cashboxes.length > 8}
            defaultPageSize={8}
            pageSizeOptions={[8, 15, 25]}
            exportFilename="أرصدة-الخزائن-والبنوك"
            pdfTitle="أرصدة الخزائن والبنوك"
            headerActions={
              <div className="flex items-center gap-1.5">
                {renderMaskEyeButton('cashboxTable', 'أرصدة جدول الخزائن والبنوك')}
                <button
                  type="button"
                  onClick={() => onNavigate('cashboxes')}
                  className="text-[11px] text-blue-900 dark:text-[#85B8FF] font-bold hover:underline cursor-pointer whitespace-nowrap"
                >
                  إدارة الخزائن
                </button>
              </div>
            }
            columns={[
              {
                key: 'name',
                header: 'الحساب / الخزينة',
                align: 'right',
                sortValue: (cb) => cb.name,
                exportValue: (cb) => cb.name,
                render: (cb) => (
                  <div className="min-w-[130px] whitespace-normal">
                    <div className="font-bold text-slate-800 dark:text-[#F3F7FC]">{cb.name}</div>
                    <div className="text-[10px] text-slate-500 dark:text-[#97AECE]">
                      {cb.type === 'bank' ? `بنك: ${cb.accountNumber || 'جاري'}` : 'خزينة نقدية'}
                    </div>
                  </div>
                ),
              },
              {
                key: 'currentBalance',
                header: 'الرصيد',
                align: 'left',
                sortValue: (cb) => (cb.balanceHidden ? 0 : cb.currentBalance ?? 0),
                exportValue: (cb) => (cb.balanceHidden ? 'مخفي' : cb.currentBalance ?? 0),
                render: (cb) => (
                  <span
                    className="font-black text-blue-950 dark:text-[#85B8FF] font-mono tabular-nums whitespace-nowrap"
                    title={cashboxTableHidden || cb.balanceHidden ? 'الرصيد مخفي' : undefined}
                  >
                    {cashboxTableHidden || cb.balanceHidden ? (
                      <span className="tracking-widest text-slate-400 dark:text-[#85B8FF]">{MASKED_AMOUNT}</span>
                    ) : (
                      <>
                        {(cb.currentBalance ?? 0).toLocaleString()}{' '}
                        <span className="text-[10px] font-normal text-slate-500 dark:text-[#97AECE]">{settings.currency}</span>
                      </>
                    )}
                  </span>
                ),
              },
            ]}
          />
        </div>
      </div>

      {/* Recent Invoices Table */}
      <div data-testid="dashboard-recent-invoices-card">
        <UnifiedDataTable<Invoice>
          title="أحدث الفواتير المسجلة"
          data={invoices}
          rowKey={(inv) => inv.id}
          compact
          defaultPageSize={10}
          pageSizeOptions={[10, 25, 50]}
          exportFilename="أحدث-الفواتير"
          pdfTitle="أحدث الفواتير المسجلة"
          searchPlaceholder="ابحث برقم الفاتورة أو اسم العميل أو المورد..."
          headerActions={
            <div className="flex items-center gap-1.5">
              {renderMaskEyeButton('recentInvoices', 'مبالغ أحدث الفواتير')}
              <button
                type="button"
                onClick={() => onNavigate('sales-invoices')}
                className="text-xs text-blue-900 dark:text-[#85B8FF] font-bold hover:underline flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                عرض جميع الفواتير <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </div>
          }
          columns={[
            {
              key: 'invoiceNumber',
              header: 'رقم الفاتورة',
              align: 'right',
              sortValue: (inv) => inv.invoiceNumber,
              exportValue: (inv) => inv.invoiceNumber,
              render: (inv) => <span className="font-bold text-blue-900 dark:text-[#85B8FF] font-mono whitespace-nowrap">{inv.invoiceNumber}</span>,
            },
            {
              key: 'type',
              header: 'النوع',
              align: 'center',
              sortValue: (inv) => inv.type,
              exportValue: (inv) => (inv.type === 'sales' ? 'مبيعات' : 'مشتريات'),
              render: (inv) =>
                inv.type === 'sales' ? (
                  <span className="px-1.5 py-0.5 rounded bg-[#EEF3FA] dark:bg-[#16366B] text-[var(--awlad-royal-700)] dark:text-[#85B8FF] border border-[#DCE6F5] dark:border-[#2A436E] text-[10px] font-bold">مبيعات</span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#172B4D] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border border-slate-300 dark:border-[#2A436E] text-[10px] font-bold">مشتريات</span>
                ),
            },
            {
              key: 'party',
              header: 'العميل / المورد',
              align: 'right',
              sortValue: (inv) => inv.customerName || inv.supplierName || 'نقدي / عام',
              exportValue: (inv) => inv.customerName || inv.supplierName || 'نقدي / عام',
              render: (inv) => (
                <span className="font-semibold text-slate-800 dark:text-[#F3F7FC] whitespace-normal">{inv.customerName || inv.supplierName || 'نقدي / عام'}</span>
              ),
            },
            {
              key: 'date',
              header: 'التاريخ',
              align: 'center',
              sortValue: (inv) => inv.date,
              exportValue: (inv) => inv.date,
              render: (inv) => <span className="text-slate-500 dark:text-[#97AECE] font-mono tabular-nums whitespace-nowrap">{inv.date}</span>,
            },
            {
              key: 'warehouseName',
              header: 'المستودع',
              align: 'right',
              sortValue: (inv) => inv.warehouseName || '',
              exportValue: (inv) => inv.warehouseName || '',
              render: (inv) => <span className="text-slate-600 dark:text-[#A9BCD9] whitespace-normal">{inv.warehouseName}</span>,
            },
            {
              key: 'grandTotal',
              header: 'الإجمالي',
              align: 'center',
              sortValue: (inv) => inv.grandTotal,
              exportValue: (inv) => inv.grandTotal,
              render: (inv) => (
                <span
                  className="font-black text-slate-900 dark:text-[#F3F7FC] font-mono tabular-nums whitespace-nowrap"
                  title={recentInvoicesHidden ? 'المبلغ مخفي' : undefined}
                >
                  {recentInvoicesHidden ? (
                    <span className="tracking-widest text-slate-400 dark:text-[#85B8FF]">{MASKED_AMOUNT}</span>
                  ) : (
                    `${inv.grandTotal.toLocaleString()} ${settings.currency}`
                  )}
                </span>
              ),
            },
            {
              key: 'paidAmount',
              header: 'المدفوع',
              align: 'center',
              sortValue: (inv) => inv.paidAmount,
              exportValue: (inv) => inv.paidAmount,
              render: (inv) => (
                <span
                  className="font-bold text-emerald-700 dark:text-emerald-400 font-mono tabular-nums whitespace-nowrap"
                  title={recentInvoicesHidden ? 'المبلغ مخفي' : undefined}
                >
                  {recentInvoicesHidden ? (
                    <span className="tracking-widest text-slate-400 dark:text-[#85B8FF]">{MASKED_AMOUNT}</span>
                  ) : (
                    inv.paidAmount.toLocaleString()
                  )}
                </span>
              ),
            },
            {
              key: 'remainingAmount',
              header: 'المتبقي',
              align: 'center',
              sortValue: (inv) => inv.remainingAmount,
              exportValue: (inv) => inv.remainingAmount,
              render: (inv) => (
                <span
                  className="font-bold text-red-600 dark:text-rose-400 font-mono tabular-nums whitespace-nowrap"
                  title={recentInvoicesHidden ? 'المبلغ مخفي' : undefined}
                >
                  {recentInvoicesHidden ? (
                    <span className="tracking-widest text-slate-400 dark:text-[#85B8FF]">{MASKED_AMOUNT}</span>
                  ) : (
                    inv.remainingAmount.toLocaleString()
                  )}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'الحالة',
              align: 'center',
              sortValue: (inv) => inv.status,
              exportValue: (inv) => (inv.status === 'confirmed' ? 'مؤكدة' : inv.status === 'draft' ? 'مسودة' : 'ملغاة'),
              render: (inv) =>
                inv.status === 'confirmed' ? (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-400/30 text-[10px] font-bold">مؤكدة</span>
                ) : inv.status === 'draft' ? (
                  <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-400/30 text-[10px] font-bold">مسودة</span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-400/30 text-[10px] font-bold">ملغاة</span>
                ),
            },
            {
              key: 'actions',
              header: 'الإجراءات',
              align: 'center',
              sortable: false,
              render: (inv) => (
                <button
                  type="button"
                  onClick={() => onNavigate(inv.type === 'sales' ? 'sales-invoices' : 'purchase-invoices')}
                  className="p-1.5 rounded text-slate-600 dark:text-[#A9BCD9] hover:text-blue-900 dark:hover:text-[#85B8FF] hover:bg-blue-50 dark:hover:bg-[#1A3461] transition-colors cursor-pointer"
                  title="عرض الفاتورة"
                >
                  <Eye className="w-4 h-4" />
                </button>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
};

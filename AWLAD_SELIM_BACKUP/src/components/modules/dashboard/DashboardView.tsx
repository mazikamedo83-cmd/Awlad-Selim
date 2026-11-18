import React, { useState, useMemo } from 'react';
import { 
  TrendingUp, TrendingDown, DollarSign, ShoppingCart, Truck, Boxes, 
  Wallet, AlertTriangle, ArrowLeftRight, Clock, Calendar, CheckCircle2, 
  ChevronLeft, ArrowUpRight, ArrowDownRight, Eye, RefreshCw, Layers 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { NavItemKey } from '../../layout/Sidebar';

interface DashboardViewProps {
  onNavigate: (page: NavItemKey) => void;
  onViewInvoice?: (invoiceId: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate, onViewInvoice }) => {
  const { 
    invoices, products, customers, suppliers, cashboxes, 
    repTransfers, installments, expenseIncomes, settings 
  } = useData();
  const { currentUser, hasPermission } = useAuth();

  // Date range filter
  const [dateFilter, setDateFilter] = useState<'today' | 'yesterday' | '7days' | 'thisMonth' | 'prevMonth' | 'thisYear'>('thisMonth');

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
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (dateFilter === 'thisMonth') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (dateFilter === 'prevMonth') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    } else if (dateFilter === 'thisYear') {
      startDate = new Date(now.getFullYear(), 0, 1);
    }

    return { startDate, endDate };
  }, [dateFilter]);

  const todayStr = new Date().toISOString().split('T')[0];

  // Sales totals
  const confirmedSales = invoices.filter(i => i.type === 'sales' && i.status === 'confirmed');
  const totalSales = confirmedSales.reduce((acc, i) => acc + i.grandTotal, 0);
  const todaySales = confirmedSales.filter(i => i.date === todayStr).reduce((acc, i) => acc + i.grandTotal, 0);

  // Purchases totals
  const confirmedPurchases = invoices.filter(i => i.type === 'purchase' && i.status === 'confirmed');
  const totalPurchases = confirmedPurchases.reduce((acc, i) => acc + i.grandTotal, 0);
  const todayPurchases = confirmedPurchases.filter(i => i.date === todayStr).reduce((acc, i) => acc + i.grandTotal, 0);

  // Expenses & Income
  const totalExpenses = expenseIncomes.filter(e => e.type === 'expense').reduce((acc, e) => acc + e.amount, 0);
  const totalIncome = expenseIncomes.filter(e => e.type === 'income').reduce((acc, e) => acc + e.amount, 0);

  // Cashbox total
  const totalCashAndBanks = cashboxes.reduce((acc, c) => acc + c.currentBalance, 0);

  // Debts
  const customerDebtsTotal = customers.reduce((acc, c) => acc + (c.currentBalance > 0 ? c.currentBalance : 0), 0);
  const supplierDebtsTotal = suppliers.reduce((acc, s) => acc + (s.currentBalance > 0 ? s.currentBalance : 0), 0);

  // Inventory value & low stock alerts
  const inventoryValue = products.reduce((acc, prod) => {
    const totalQty = Object.values(prod.stockPerWarehouse).reduce((q, v) => q + v, 0);
    return acc + (totalQty * prod.purchasePrice);
  }, 0);

  const lowStockProducts = products.filter(prod => {
    const totalQty = Object.values(prod.stockPerWarehouse).reduce((q, v) => q + v, 0);
    return totalQty <= prod.minStockLevel;
  });

  // Pending transfers count ("طلب تحويل بالنصف")
  const pendingTransfers = repTransfers.filter(t => t.status === 'awaiting_receipt');

  // Outstanding installments
  const overdueInstallmentsCount = installments.flatMap(s => s.items).filter(item => {
    return item.status === 'pending' && new Date(item.dueDate) < new Date();
  }).length;

  // Approximate gross profit calculation: Sales total - cost of goods sold
  const estimatedProfit = totalSales - totalPurchases - totalExpenses + totalIncome;

  return (
    <div className="space-y-6">
      {/* Welcome & Top Filter Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <span>مرحباً، {currentUser?.fullName}</span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200">
              {currentUser?.jobTitle}
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            نظام أولاد سليم لتجارة المواد الغذائية بالجملة • آخر تحديث: اليوم {new Date().toLocaleDateString('ar-EG')}
          </p>
        </div>

        {/* Date Filter selector */}
        <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200 text-xs">
          <Calendar className="w-4 h-4 text-slate-500 mr-1" />
          <span className="text-slate-500 font-bold ml-1">الفترة:</span>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as any)}
            className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-800 focus:outline-hidden focus:border-blue-600"
          >
            <option value="today">اليوم</option>
            <option value="yesterday">أمس</option>
            <option value="7days">آخر 7 أيام</option>
            <option value="thisMonth">الشهر الحالي (افتراضي)</option>
            <option value="prevMonth">الشهر السابق</option>
            <option value="thisYear">السنة المالية الحالية</option>
          </select>
        </div>
      </div>

      {/* Low Stock and Pending Transfer Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {pendingTransfers.length > 0 && (
          <div 
            onClick={() => onNavigate('rep-transfers')}
            className="flex items-center justify-between p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 shadow-xs cursor-pointer hover:bg-amber-100/80 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold">
                <ArrowLeftRight className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-black">
                  يوجد {pendingTransfers.length} طلب تحويل بالنصف في انتظار تأكيد الاستلام
                </h4>
                <p className="text-[11px] text-amber-700 mt-0.5">
                  انقر للاطلاع وتأكيد استلام المبالغ وتحديث الأرصدة المالية تلقائياً
                </p>
              </div>
            </div>
            <ChevronLeft className="w-5 h-5 text-amber-600" />
          </div>
        )}

        {lowStockProducts.length > 0 && (
          <div 
            onClick={() => onNavigate('products')}
            className="flex items-center justify-between p-4 rounded-2xl bg-red-50 border border-red-200 text-red-900 shadow-xs cursor-pointer hover:bg-red-100/80 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-600 text-white flex items-center justify-center font-bold">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-black">
                  تنبيه: {lowStockProducts.length} أصناف وصلت أو تجاوزت حد الطلب الأدنى
                </h4>
                <p className="text-[11px] text-red-700 mt-0.5">
                  أصناف غذائية قاربت على النفاد، يرجى مراجعة وتجهيز طلبيات الشراء
                </p>
              </div>
            </div>
            <ChevronLeft className="w-5 h-5 text-red-600" />
          </div>
        )}
      </div>

      {/* Main KPI Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {/* Total Sales */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-blue-400 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500">إجمالي المبيعات</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-900 flex items-center justify-center">
              <ShoppingCart className="w-4 h-4" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-black text-slate-900">
            {totalSales.toLocaleString()} <span className="text-xs font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-600 font-bold mt-2">
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>مبيعات اليوم: {todaySales.toLocaleString()} {settings.currency}</span>
          </div>
        </div>

        {/* Total Purchases */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-blue-400 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500">إجمالي المشتريات</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-900 flex items-center justify-center">
              <Truck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-black text-slate-900">
            {totalPurchases.toLocaleString()} <span className="text-xs font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-indigo-600 font-bold mt-2">
            <Truck className="w-3.5 h-3.5" />
            <span>مشتريات اليوم: {todayPurchases.toLocaleString()} {settings.currency}</span>
          </div>
        </div>

        {/* Cashbox & Bank Balances */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-emerald-400 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500">أرصدة الخزائن والبنوك</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-900 flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-black text-emerald-700">
            {totalCashAndBanks.toLocaleString()} <span className="text-xs font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-semibold mt-2">
            إجمالي السيولة النقدية والبنكية
          </div>
        </div>

        {/* Inventory Value */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-amber-400 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500">قيمة بضاعة المخزون</span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-900 flex items-center justify-center">
              <Boxes className="w-4 h-4" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-black text-slate-900">
            {inventoryValue.toLocaleString()} <span className="text-xs font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-semibold mt-2">
            بسعر التكلفة لـ {products.length} صنف غذائي
          </div>
        </div>

        {/* Customer Debts */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-rose-400 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500">ديون العملاء (مستحقاتنا)</span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-900 flex items-center justify-center">
              <ArrowDownRight className="w-4 h-4" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-black text-rose-700">
            {customerDebtsTotal.toLocaleString()} <span className="text-xs font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-semibold mt-2">
            مديونيات آجلة على {customers.length} عميل
          </div>
        </div>

        {/* Supplier Debts */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-purple-400 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500">مستحقات الموردين علينا</span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-900 flex items-center justify-center">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-black text-purple-700">
            {supplierDebtsTotal.toLocaleString()} <span className="text-xs font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-semibold mt-2">
            فواتير آجلة لـ {suppliers.length} مورد
          </div>
        </div>

        {/* Total Expenses */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-slate-400 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500">إجمالي المصروفات</span>
            <div className="w-8 h-8 rounded-xl bg-orange-50 text-orange-900 flex items-center justify-center">
              <TrendingDown className="w-4 h-4" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-black text-orange-700">
            {totalExpenses.toLocaleString()} <span className="text-xs font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-semibold mt-2">
            وقود، كهرباء، ونثريات تشغيل
          </div>
        </div>

        {/* Total Revenues / Income */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs hover:border-teal-400 transition-all">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500">الإيرادات المتنوعة</span>
            <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-900 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-lg sm:text-xl font-black text-teal-700">
            {totalIncome.toLocaleString()} <span className="text-xs font-semibold text-slate-500">{settings.currency}</span>
          </div>
          <div className="text-[11px] text-slate-500 font-semibold mt-2">
            إيرادات تخريد وفوارغ وغيرها
          </div>
        </div>
      </div>

      {/* Visual Activity & Charts Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales & Profit Visual Bar Chart */}
        <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-900">حركة المبيعات والمشتريات خلال الأيام الماضية</h3>
              <p className="text-xs text-slate-500">مقارنة حركة التداول وقيم الفواتير المؤكدة</p>
            </div>
            <div className="flex items-center gap-3 text-xs font-bold">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-blue-600"></span> المبيعات</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-slate-300"></span> المشتريات</span>
            </div>
          </div>

          {/* Responsive CSS Bar Chart */}
          <div className="h-48 pt-6 flex items-end justify-between gap-3 border-b border-slate-200">
            {[
              { day: 'السبت', sales: 42000, purchases: 30000 },
              { day: 'الأحد', sales: 58000, purchases: 20000 },
              { day: 'الإثنين', sales: 35000, purchases: 45000 },
              { day: 'الثلاثاء', sales: 65000, purchases: 15000 },
              { day: 'الأربعاء', sales: 78000, purchases: 50000 },
              { day: 'الخميس', sales: 92000, purchases: 38000 },
              { day: 'اليوم', sales: 43500, purchases: 28000 },
            ].map((d, idx) => {
              const maxVal = 100000;
              const salesH = Math.min(100, (d.sales / maxVal) * 100);
              const purH = Math.min(100, (d.purchases / maxVal) * 100);

              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group">
                  <div className="flex items-end gap-1.5 w-full justify-center h-full">
                    <div 
                      style={{ height: `${salesH}%` }} 
                      className="w-4 sm:w-6 bg-blue-600 rounded-t-md hover:bg-blue-700 transition-all cursor-pointer relative"
                      title={`مبيعات: ${d.sales} ج.م`}
                    />
                    <div 
                      style={{ height: `${purH}%` }} 
                      className="w-4 sm:w-6 bg-slate-300 rounded-t-md hover:bg-slate-400 transition-all cursor-pointer relative"
                      title={`مشتريات: ${d.purchases} ج.م`}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 mt-1">{d.day}</span>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between text-xs text-slate-600 pt-1">
            <span>متوسط دورة رأس المال سريعة وممتازة</span>
            <button 
              onClick={() => onNavigate('reports')}
              className="text-blue-700 font-bold hover:underline flex items-center gap-1"
            >
              عرض تقرير المبيعات والأرباح المفصل <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Quick Cashboxes Balance Breakdown */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h3 className="text-sm font-black text-slate-900">الخزائن والحسابات النشطة</h3>
            <button 
              onClick={() => onNavigate('cashboxes')}
              className="text-xs text-blue-700 font-bold hover:underline"
            >
              إدارة الخزائن
            </button>
          </div>

          <div className="space-y-2.5">
            {cashboxes.map(cb => (
              <div key={cb.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <span className="block text-xs font-bold text-slate-800">{cb.name}</span>
                  <span className="text-[10px] text-slate-500 font-medium">
                    {cb.type === 'bank' ? `حساب بنكي: ${cb.accountNumber || 'جاري'}` : 'خزينة نقدية رئيسية'}
                  </span>
                </div>
                <div className="text-left font-black text-sm text-blue-950">
                  {cb.currentBalance.toLocaleString()} <span className="text-[10px] font-normal text-slate-500">{settings.currency}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Quick Shortcuts */}
          <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
            <button
              onClick={() => onNavigate('new-sale')}
              className="p-2.5 rounded-xl bg-blue-900 text-white font-bold hover:bg-blue-950 transition-colors text-center"
            >
              + فاتورة بيع جديدة
            </button>
            <button
              onClick={() => onNavigate('rep-transfers')}
              className="p-2.5 rounded-xl bg-amber-600 text-white font-bold hover:bg-amber-700 transition-colors text-center"
            >
              طلب تحويل بالنصف
            </button>
          </div>
        </div>
      </div>

      {/* Recent Invoices Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-slate-900">أحدث العمليات والفواتير المسجلة</h3>
            <p className="text-xs text-slate-500">فواتير المبيعات والمشتريات الصادرة والواردة حديثاً</p>
          </div>
          <button
            onClick={() => onNavigate('sales-invoices')}
            className="text-xs text-blue-700 font-bold hover:underline flex items-center gap-1"
          >
            عرض جميع الفواتير <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                <th className="p-3.5">رقم الفاتورة</th>
                <th className="p-3.5">النوع</th>
                <th className="p-3.5">العميل / المورد</th>
                <th className="p-3.5">التاريخ</th>
                <th className="p-3.5">المستودع</th>
                <th className="p-3.5">الإجمالي</th>
                <th className="p-3.5">المدفوع</th>
                <th className="p-3.5">المتبقي</th>
                <th className="p-3.5">الحالة</th>
                <th className="p-3.5 text-center">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.slice(0, 7).map(inv => (
                <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-3.5 font-bold text-blue-900 font-mono">{inv.invoiceNumber}</td>
                  <td className="p-3.5">
                    {inv.type === 'sales' ? (
                      <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold">مبيعات</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px] font-bold">مشتريات</span>
                    )}
                  </td>
                  <td className="p-3.5 font-semibold text-slate-800">
                    {inv.customerName || inv.supplierName || 'نقدي / عام'}
                  </td>
                  <td className="p-3.5 text-slate-500 font-mono">{inv.date}</td>
                  <td className="p-3.5 text-slate-600">{inv.warehouseName}</td>
                  <td className="p-3.5 font-black text-slate-900">{inv.grandTotal.toLocaleString()} {settings.currency}</td>
                  <td className="p-3.5 font-bold text-emerald-700">{inv.paidAmount.toLocaleString()}</td>
                  <td className="p-3.5 font-bold text-red-600">{inv.remainingAmount.toLocaleString()}</td>
                  <td className="p-3.5">
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                      مؤكدة
                    </span>
                  </td>
                  <td className="p-3.5 text-center">
                    <button
                      onClick={() => {
                        if (inv.type === 'sales') {
                          onNavigate('sales-invoices');
                        } else {
                          onNavigate('purchase-invoices');
                        }
                      }}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 transition-colors"
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

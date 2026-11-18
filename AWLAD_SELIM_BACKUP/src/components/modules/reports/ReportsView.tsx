import React, { useState, useMemo } from 'react';
import { 
  FileBarChart, Printer, Download, Calendar, Filter, DollarSign, 
  TrendingUp, TrendingDown, ShoppingCart, Truck, Boxes, Wallet, Users2 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';

export const ReportsView: React.FC = () => {
  const { 
    invoices, products, customers, suppliers, cashboxes, 
    repTransfers, installments, expenseIncomes, settings, employees, payrolls 
  } = useData();

  // Date filter (Default: First day of current month through today as requested in spec 18)
  const [dateFilter, setDateFilter] = useState<'thisMonth' | 'today' | 'yesterday' | '7days' | 'prevMonth' | 'thisYear' | 'custom'>('thisMonth');
  const [customStartDate, setCustomStartDate] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  );
  const [customEndDate, setCustomEndDate] = useState(new Date().toISOString().split('T')[0]);

  // Selected report category
  const [selectedReport, setSelectedReport] = useState<
    'sales' | 'purchases' | 'pnl' | 'income_expense' | 'cashbox' | 'customer_debts' | 'supplier_debts' | 'inventory_valuation' | 'rep_performance' | 'rep_transfers' | 'cheques' | 'installments' | 'payroll'
  >('pnl');

  // Print modal
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  // Date Range calculation
  const dateRange = useMemo(() => {
    const now = new Date();
    let start = new Date(now.getFullYear(), now.getMonth(), 1);
    let end = new Date();

    if (dateFilter === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (dateFilter === 'yesterday') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    } else if (dateFilter === '7days') {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (dateFilter === 'prevMonth') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (dateFilter === 'thisYear') {
      start = new Date(now.getFullYear(), 0, 1);
    } else if (dateFilter === 'custom') {
      start = new Date(customStartDate);
      end = new Date(customEndDate);
    }

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    return { startStr, endStr };
  }, [dateFilter, customStartDate, customEndDate]);

  // Filtered dataset
  const periodSales = invoices.filter(i => i.type === 'sales' && i.status === 'confirmed' && i.date >= dateRange.startStr && i.date <= dateRange.endStr);
  const periodPurchases = invoices.filter(i => i.type === 'purchase' && i.status === 'confirmed' && i.date >= dateRange.startStr && i.date <= dateRange.endStr);
  const periodExpenses = expenseIncomes.filter(e => e.type === 'expense' && e.date >= dateRange.startStr && e.date <= dateRange.endStr);
  const periodIncomes = expenseIncomes.filter(e => e.type === 'income' && e.date >= dateRange.startStr && e.date <= dateRange.endStr);

  const totalSalesVal = periodSales.reduce((a, b) => a + b.grandTotal, 0);
  const totalPurchasesVal = periodPurchases.reduce((a, b) => a + b.grandTotal, 0);
  const totalExpensesVal = periodExpenses.reduce((a, b) => a + b.amount, 0);
  const totalIncomesVal = periodIncomes.reduce((a, b) => a + b.amount, 0);

  // Approximate gross and net profit
  const grossProfit = totalSalesVal - totalPurchasesVal;
  const netProfit = grossProfit - totalExpensesVal + totalIncomesVal;

  const handlePrintCurrentReport = () => {
    setPrintData({
      title: `تقرير محاسبي رسمي - ${selectedReport.toUpperCase()}`,
      docNumber: `REP-${Date.now().toString().slice(-6)}`,
      docType: 'كشف حساب',
      date: `${dateRange.startStr} إلى ${dateRange.endStr}`,
      grandTotal: selectedReport === 'pnl' ? netProfit : totalSalesVal,
      notes: `الفترة المحددة: من ${dateRange.startStr} حتى ${dateRange.endStr}`,
      items: selectedReport === 'pnl' ? [
        { name: 'إجمالي المبيعات المؤكدة', unit: 'إيراد', quantity: 1, price: totalSalesVal, total: totalSalesVal },
        { name: 'إجمالي المشتريات والتوريدات', unit: 'تكلفة', quantity: 1, price: totalPurchasesVal, total: totalPurchasesVal },
        { name: 'إجمالي المصروفات والنثريات', unit: 'مصروف', quantity: 1, price: totalExpensesVal, total: totalExpensesVal },
        { name: 'إيرادات أخرى متنوعة', unit: 'إيراد', quantity: 1, price: totalIncomesVal, total: totalIncomesVal },
      ] : periodSales.map(s => ({
        name: `فاتورة ${s.invoiceNumber} - ${s.customerName}`,
        unit: s.paymentType,
        quantity: 1,
        price: s.grandTotal,
        total: s.grandTotal,
      })),
    });
    setIsPrintModalOpen(true);
  };

  const handleExportExcel = () => {
    let headers: string[] = [];
    let rows: any[][] = [];

    if (selectedReport === 'sales') {
      headers = ['رقم الفاتورة', 'التاريخ', 'العميل', 'المستودع', 'المبلغ الإجمالي', 'المدفوع', 'المتبقي'];
      rows = periodSales.map(s => [s.invoiceNumber, s.date, s.customerName, s.warehouseName, s.grandTotal, s.paidAmount, s.remainingAmount]);
    } else if (selectedReport === 'purchases') {
      headers = ['رقم الفاتورة', 'التاريخ', 'المورد', 'المستودع', 'المبلغ الإجمالي', 'المدفوع', 'المتبقي'];
      rows = periodPurchases.map(p => [p.invoiceNumber, p.date, p.supplierName, p.warehouseName, p.grandTotal, p.paidAmount, p.remainingAmount]);
    } else if (selectedReport === 'customer_debts') {
      headers = ['كود العميل', 'اسم العميل', 'رقم الهاتف', 'الرصيد الافتتاحي', 'المديونية الحالية'];
      rows = customers.map(c => [c.code, c.name, c.phone, c.openingBalance, c.currentBalance]);
    } else {
      headers = ['البند', 'المبلغ'];
      rows = [
        ['إجمالي المبيعات', totalSalesVal],
        ['إجمالي المشتريات', totalPurchasesVal],
        ['إجمالي المصروفات', totalExpensesVal],
        ['صافي الأرباح المقدرة', netProfit],
      ];
    }

    exportToExcel(`تقرير_أولاد_سليم_${selectedReport}_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">التقارير المالية والمحاسبية الشاملة</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            تحليل الأرباح والخسائر، حركة المبيعات، أعمار الديون، وتقييم المخزون
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 text-slate-700"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span>تصدير Excel</span>
          </button>
          <button
            onClick={handlePrintCurrentReport}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-xs font-black shadow-md"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة التقرير (A4 / حراري)</span>
          </button>
        </div>
      </div>

      {/* Date Filter selector bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-500" />
          <span className="font-bold text-slate-700">الفترة الزمنية:</span>
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as any)}
            className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-1.5 font-bold"
          >
            <option value="thisMonth">الشهر الحالي (افتراضي: 1 من الشهر حتى اليوم)</option>
            <option value="today">اليوم</option>
            <option value="yesterday">أمس</option>
            <option value="7days">آخر 7 أيام</option>
            <option value="prevMonth">الشهر السابق</option>
            <option value="thisYear">السنة الحالية</option>
            <option value="custom">فترة مخصصة</option>
          </select>
        </div>

        {dateFilter === 'custom' && (
          <div className="flex items-center gap-2">
            <span>من:</span>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              className="border rounded-lg p-1 font-mono"
            />
            <span>إلى:</span>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              className="border rounded-lg p-1 font-mono"
            />
          </div>
        )}

        <div className="font-mono text-[11px] text-slate-500 font-bold">
          الفترة الفعلية: {dateRange.startStr} ⬅ {dateRange.endStr}
        </div>
      </div>

      {/* Report Types Navigator */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 text-xs font-bold">
        {[
          { key: 'pnl', label: 'الأرباح والخسائر' },
          { key: 'sales', label: 'تقرير المبيعات' },
          { key: 'purchases', label: 'تقرير المشتريات' },
          { key: 'customer_debts', label: 'ديون العملاء' },
          { key: 'supplier_debts', label: 'أرصدة الموردين' },
          { key: 'rep_transfers', label: 'تحويلات المناديب بالنصف' },
        ].map(r => (
          <button
            key={r.key}
            onClick={() => setSelectedReport(r.key as any)}
            className={`p-3 rounded-xl border text-center transition-all ${
              selectedReport === r.key
                ? 'bg-blue-900 text-white border-blue-900 shadow-md font-black'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Report Data Render */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6">
        {/* P&L Report */}
        {selectedReport === 'pnl' && (
          <div className="space-y-6">
            <h3 className="text-base font-black text-slate-900 border-b pb-3">
              قائمة الدخل والأرباح المقدرة للفترة ({dateRange.startStr} - {dateRange.endStr})
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
                <span className="text-xs font-bold text-slate-600 block">إجمالي المبيعات</span>
                <span className="text-lg font-black text-blue-950 font-mono mt-1 block">
                  {totalSalesVal.toLocaleString()} {settings.currency}
                </span>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-xs font-bold text-slate-600 block">تكلفة المشتريات</span>
                <span className="text-lg font-black text-slate-800 font-mono mt-1 block">
                  {totalPurchasesVal.toLocaleString()} {settings.currency}
                </span>
              </div>
              <div className="p-4 rounded-xl bg-orange-50 border border-orange-200">
                <span className="text-xs font-bold text-slate-600 block">إجمالي المصروفات</span>
                <span className="text-lg font-black text-orange-800 font-mono mt-1 block">
                  {totalExpensesVal.toLocaleString()} {settings.currency}
                </span>
              </div>
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <span className="text-xs font-bold text-slate-600 block">صافي الأرباح التقديرية</span>
                <span className="text-lg font-black text-emerald-800 font-mono mt-1 block">
                  {netProfit.toLocaleString()} {settings.currency}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Sales Report */}
        {selectedReport === 'sales' && (
          <div>
            <h3 className="text-sm font-black mb-3">فواتير المبيعات الصادرة خلال الفترة ({periodSales.length} فاتورة)</h3>
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 font-bold border-b">
                  <th className="p-2.5">رقم الفاتورة</th>
                  <th className="p-2.5">التاريخ</th>
                  <th className="p-2.5">العميل</th>
                  <th className="p-2.5 text-center">الإجمالي</th>
                  <th className="p-2.5 text-center">المدفوع</th>
                  <th className="p-2.5 text-center">المتبقي</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {periodSales.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="p-2.5 font-mono font-bold text-blue-900">{s.invoiceNumber}</td>
                    <td className="p-2.5 font-mono">{s.date}</td>
                    <td className="p-2.5 font-bold">{s.customerName}</td>
                    <td className="p-2.5 text-center font-black">{s.grandTotal.toLocaleString()}</td>
                    <td className="p-2.5 text-center text-emerald-700 font-bold">{s.paidAmount.toLocaleString()}</td>
                    <td className="p-2.5 text-center text-red-700 font-bold">{s.remainingAmount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Customer Debts Report */}
        {selectedReport === 'customer_debts' && (
          <div>
            <h3 className="text-sm font-black mb-3">تقرير مديونيات وأرصدة العملاء المستحقة</h3>
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 font-bold border-b">
                  <th className="p-2.5">كود العميل</th>
                  <th className="p-2.5">الاسم</th>
                  <th className="p-2.5">الهاتف</th>
                  <th className="p-2.5">العنوان</th>
                  <th className="p-2.5 text-center">المديونية الحالية للشركة</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {customers.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="p-2.5 font-mono font-bold text-blue-900">{c.code}</td>
                    <td className="p-2.5 font-bold">{c.name}</td>
                    <td className="p-2.5 font-mono">{c.phone}</td>
                    <td className="p-2.5 text-slate-600">{c.address}</td>
                    <td className="p-2.5 text-center font-mono font-black text-red-700">
                      {c.currentBalance.toLocaleString()} {settings.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Rep Transfers Report */}
        {selectedReport === 'rep_transfers' && (
          <div>
            <h3 className="text-sm font-black mb-3">تقرير حركات نظام "طلب تحويل بالنصف" للمناديب</h3>
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 font-bold border-b">
                  <th className="p-2.5">رقم التحويل</th>
                  <th className="p-2.5">التاريخ</th>
                  <th className="p-2.5">المرسل</th>
                  <th className="p-2.5">المستلم</th>
                  <th className="p-2.5 text-center">المبلغ</th>
                  <th className="p-2.5">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {repTransfers.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="p-2.5 font-mono font-bold text-blue-900">{t.transferNumber}</td>
                    <td className="p-2.5 font-mono">{t.date}</td>
                    <td className="p-2.5 font-bold">{t.senderName}</td>
                    <td className="p-2.5 font-bold">{t.receiverName}</td>
                    <td className="p-2.5 text-center font-mono font-black text-blue-950">{t.amount.toLocaleString()}</td>
                    <td className="p-2.5 font-bold">
                      {t.status === 'received' ? <span className="text-emerald-700">تم الاستلام وتعديل الأرصدة</span> : <span className="text-amber-700">قيد الاستلام</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Print Document Modal */}
      <PrintDocumentModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        data={printData}
      />
    </div>
  );
};

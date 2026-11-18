import React, { useState, useMemo } from 'react';
import { 
  FileBarChart, Printer, Download, Calendar, Filter, DollarSign, 
  TrendingUp, TrendingDown, ShoppingCart, Truck, Boxes, Wallet, Users2, FileDown 
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';
import { exportTableToPdf } from '../../common/PdfExporter';

export const ReportsView: React.FC = () => {
  const { 
    invoices, products, customers, suppliers, cashboxes, 
    repTransfers, installments, expenseIncomes, settings, employees, payrolls,
    ownerAccounts = [], ownerTransactions = [], stockCounts = [], stockTransferRequests = [],
  } = useData();
  const { currentUser, hasPermission } = useAuth();

  // Date filter (Default: First day of current month through today as requested in spec 18)
  const [dateFilter, setDateFilter] = useState<'thisMonth' | 'today' | 'yesterday' | '7days' | 'prevMonth' | 'thisYear' | 'custom'>('thisMonth');
  const [customStartDate, setCustomStartDate] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  );
  const [customEndDate, setCustomEndDate] = useState(new Date().toISOString().split('T')[0]);

  // Selected report category
  const [selectedReport, setSelectedReport] = useState<
    'sales' | 'purchases' | 'pnl' | 'income_expense' | 'cashbox' | 'customer_debts' | 'supplier_debts' | 'inventory_valuation' | 'rep_performance' | 'rep_transfers' | 'cheques' | 'installments' | 'payroll' | 'personal_accounts' | 'stock_counts' | 'stock_transfers'
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

  const getReportTableData = () => {
    let reportTitle = 'تقرير محاسبي';
    let headers: string[] = [];
    let rows: Array<Array<string | number>> = [];

    if (selectedReport === 'sales') {
      reportTitle = 'تقرير المبيعات المعتمدة';
      headers = ['رقم الفاتورة', 'التاريخ', 'العميل', 'المستودع', 'الإجمالي', 'المدفوع', 'المتبقي'];
      rows = periodSales.map(s => [s.invoiceNumber, s.date, s.customerName || 'نقدي', s.warehouseName, s.grandTotal, s.paidAmount, s.remainingAmount]);
    } else if (selectedReport === 'purchases') {
      reportTitle = 'تقرير المشتريات المعتمدة';
      headers = ['رقم الفاتورة', 'التاريخ', 'المورد', 'المستودع', 'الإجمالي', 'المدفوع', 'المتبقي'];
      rows = periodPurchases.map(p => [p.invoiceNumber, p.date, p.supplierName || 'مورد', p.warehouseName, p.grandTotal, p.paidAmount, p.remainingAmount]);
    } else if (selectedReport === 'customer_debts') {
      reportTitle = 'تقرير مديونيات العملاء';
      headers = ['كود العميل', 'اسم العميل', 'رقم الهاتف', 'الرصيد الافتتاحي', 'المديونية الحالية'];
      rows = customers.map(c => [c.code, c.name, c.phone, c.openingBalance, c.currentBalance]);
    } else if (selectedReport === 'supplier_debts') {
      reportTitle = 'تقرير أرصدة ومستحقات الموردين';
      headers = ['كود المورد', 'اسم المورد', 'الهاتف', 'الرصيد الافتتاحي', 'الرصيد المستحق'];
      rows = suppliers.map(s => [s.code, s.name, s.phone, s.openingBalance, s.currentBalance]);
    } else if (selectedReport === 'rep_transfers') {
      reportTitle = 'تقرير تحويلات المناديب بالنصف';
      headers = ['رقم التحويل', 'التاريخ', 'المرسل', 'المستلم', 'المبلغ', 'الحالة'];
      rows = repTransfers.map(t => [t.transferNumber, t.date, t.senderName, t.receiverName, t.amount, t.status === 'received' ? 'تم الاستلام' : 'قيد الاستلام']);
    } else if (selectedReport === 'personal_accounts') {
      reportTitle = 'تقرير الحسابات الشخصية للملاك';
      headers = ['رقم الحركة', 'التاريخ', 'الحساب الشخصي', 'النوع', 'المبلغ', 'الخزينة', 'السبب / البيان'];
      rows = ownerTransactions
        .filter(tx => tx.date >= dateRange.startStr && tx.date <= dateRange.endStr)
        .map(tx => {
          const acc = ownerAccounts.find(a => a.id === tx.accountId);
          return [
            tx.txNumber,
            tx.date,
            acc ? `${acc.ownerName} - ${acc.accountName}` : tx.accountId,
            tx.type,
            tx.amount,
            tx.cashboxName || 'غير مرتبط بخزينة',
            tx.reason || tx.notes || '-',
          ];
        });
    } else if (selectedReport === 'stock_counts') {
      reportTitle = 'تقرير جلسات جرد المخزون';
      headers = ['رقم الجرد', 'التاريخ', 'المستودع', 'عدد الأصناف', 'صافي الفرق', 'الحالة', 'أنشئ بواسطة'];
      rows = stockCounts
        .filter(c => c.date >= dateRange.startStr && c.date <= dateRange.endStr)
        .map(c => {
          const netDiff = (c.items || []).reduce((acc, it) => acc + it.varianceQty, 0);
          return [c.countNumber, c.date, c.warehouseName, c.items?.length || 0, netDiff, c.status, c.counterName];
        });
    } else if (selectedReport === 'stock_transfers') {
      reportTitle = 'تقرير أوامر تحويل الأصناف بين المستودعات';
      headers = ['رقم التحويل', 'التاريخ', 'من مستودع', 'إلى مستودع', 'عدد الأصناف', 'الحالة', 'السبب'];
      rows = stockTransferRequests
        .filter(t => t.date >= dateRange.startStr && t.date <= dateRange.endStr)
        .map(t => [t.transferNumber, t.date, t.sourceWarehouseName, t.targetWarehouseName, t.items?.length || 0, t.status, t.reason || '-']);
    } else {
      reportTitle = 'قائمة الدخل والأرباح والخسائر';
      headers = ['البند', 'المبلغ'];
      rows = [
        ['إجمالي المبيعات', totalSalesVal],
        ['إجمالي المشتريات', totalPurchasesVal],
        ['إجمالي المصروفات', totalExpensesVal],
        ['إيرادات أخرى', totalIncomesVal],
        ['صافي الأرباح المقدرة', netProfit],
      ];
    }

    return { reportTitle, headers, rows };
  };

  const handlePrintCurrentReport = () => {
    const { reportTitle } = getReportTableData();
    setPrintData({
      title: `${reportTitle} - أولاد سليم`,
      docNumber: `REP-${Date.now().toString().slice(-6)}`,
      docType: 'كشف حساب',
      date: `${dateRange.startStr} إلى ${dateRange.endStr}`,
      grandTotal: selectedReport === 'pnl' ? netProfit : selectedReport === 'purchases' ? totalPurchasesVal : totalSalesVal,
      notes: `الفترة المحددة: من ${dateRange.startStr} حتى ${dateRange.endStr}`,
      items: selectedReport === 'pnl' ? [
        { name: 'إجمالي المبيعات المؤكدة', unit: 'إيراد', quantity: 1, price: totalSalesVal, total: totalSalesVal },
        { name: 'إجمالي المشتريات والتوريدات', unit: 'تكلفة', quantity: 1, price: totalPurchasesVal, total: totalPurchasesVal },
        { name: 'إجمالي المصروفات والنثريات', unit: 'مصروف', quantity: 1, price: totalExpensesVal, total: totalExpensesVal },
        { name: 'إيرادات أخرى متنوعة', unit: 'إيراد', quantity: 1, price: totalIncomesVal, total: totalIncomesVal },
      ] : selectedReport === 'purchases' ? periodPurchases.map(p => ({
        name: `فاتورة شراء ${p.invoiceNumber} - ${p.supplierName || 'مورد'}`,
        unit: p.paymentType,
        quantity: 1,
        price: p.grandTotal,
        total: p.grandTotal,
      })) : periodSales.map(s => ({
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
    const { headers, rows } = getReportTableData();
    exportToExcel(`تقرير_أولاد_سليم_${selectedReport}_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  const handleExportPdf = () => {
    const { reportTitle, headers, rows } = getReportTableData();
    exportTableToPdf(reportTitle, headers, rows, {
      subtitle: settings.companyName,
      companyName: settings.companyName,
      companySubtitle: settings.companySubtitle,
      dateRangeText: `${dateRange.startStr} إلى ${dateRange.endStr}`,
    });
  };

  const canSeePersonalReport = currentUser?.role === 'admin' || hasPermission('canViewPersonalAccounts');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">التقارير المالية والمحاسبية الشاملة</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            تحليل الأرباح والخسائر، حركة المبيعات والمشتريات، الجرد والتحويلات، والحسابات الشخصية
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 text-slate-700 cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span>تصدير Excel</span>
          </button>
          <button
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-red-200 bg-red-50 rounded-xl text-xs font-bold hover:bg-red-100 text-red-800 cursor-pointer"
          >
            <FileDown className="w-4 h-4 text-red-700" />
            <span>تصدير PDF</span>
          </button>
          <button
            onClick={handlePrintCurrentReport}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
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
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 text-xs font-bold">
        {[
          { key: 'pnl', label: 'الأرباح والخسائر' },
          { key: 'sales', label: 'تقرير المبيعات' },
          { key: 'purchases', label: 'تقرير المشتريات' },
          { key: 'customer_debts', label: 'ديون العملاء' },
          { key: 'supplier_debts', label: 'أرصدة الموردين' },
          { key: 'rep_transfers', label: 'تحويلات المناديب بالنصف' },
          { key: 'stock_counts', label: 'تقارير جرد المخزون' },
          { key: 'stock_transfers', label: 'تقارير تحويلات الأصناف' },
          ...(canSeePersonalReport ? [{ key: 'personal_accounts', label: 'الحسابات الشخصية للملاك' }] : []),
        ].map(r => (
          <button
            key={r.key}
            onClick={() => setSelectedReport(r.key as any)}
            className={`p-3 rounded-xl border text-center transition-all cursor-pointer ${
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
            <div className="awlad-table-scroll">
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
          </div>
        )}

        {/* Customer Debts Report */}
        {selectedReport === 'customer_debts' && (
          <div>
            <h3 className="text-sm font-black mb-3">تقرير مديونيات وأرصدة العملاء المستحقة</h3>
            <div className="awlad-table-scroll">
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
          </div>
        )}

        {/* Rep Transfers Report */}
        {selectedReport === 'rep_transfers' && (
          <div>
            <h3 className="text-sm font-black mb-3">تقرير حركات نظام "طلب تحويل بالنصف" للمناديب</h3>
            <div className="awlad-table-scroll">
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
          </div>
        )}

        {/* Purchases Report (Previously missing!) */}
        {selectedReport === 'purchases' && (
          <div>
            <h3 className="text-sm font-black mb-3">فواتير المشتريات والتوريدات خلال الفترة ({periodPurchases.length} فاتورة)</h3>
            <div className="awlad-table-scroll">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 font-bold border-b">
                  <th className="p-2.5">رقم الفاتورة</th>
                  <th className="p-2.5">التاريخ</th>
                  <th className="p-2.5">المورد</th>
                  <th className="p-2.5">المستودع</th>
                  <th className="p-2.5 text-center">الإجمالي</th>
                  <th className="p-2.5 text-center">المدفوع</th>
                  <th className="p-2.5 text-center">المتبقي</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {periodPurchases.length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-center text-slate-400">لا توجد فواتير مشتريات في هذه الفترة.</td></tr>
                ) : periodPurchases.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="p-2.5 font-mono font-bold text-blue-900">{p.invoiceNumber}</td>
                    <td className="p-2.5 font-mono">{p.date}</td>
                    <td className="p-2.5 font-bold">{p.supplierName}</td>
                    <td className="p-2.5 text-slate-600">{p.warehouseName}</td>
                    <td className="p-2.5 text-center font-black">{p.grandTotal.toLocaleString()}</td>
                    <td className="p-2.5 text-center text-emerald-700 font-bold">{p.paidAmount.toLocaleString()}</td>
                    <td className="p-2.5 text-center text-red-700 font-bold">{p.remainingAmount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* Supplier Debts Report */}
        {selectedReport === 'supplier_debts' && (
          <div>
            <h3 className="text-sm font-black mb-3">تقرير أرصدة ومستحقات الموردين</h3>
            <div className="awlad-table-scroll">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 font-bold border-b">
                  <th className="p-2.5">كود المورد</th>
                  <th className="p-2.5">اسم المورد / الشركة</th>
                  <th className="p-2.5">الهاتف</th>
                  <th className="p-2.5 text-center">الرصيد الافتتاحي</th>
                  <th className="p-2.5 text-center">الرصيد المستحق للمورد</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {suppliers.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="p-2.5 font-mono font-bold text-blue-900">{s.code}</td>
                    <td className="p-2.5 font-bold">{s.name}</td>
                    <td className="p-2.5 font-mono">{s.phone}</td>
                    <td className="p-2.5 text-center font-mono">{s.openingBalance.toLocaleString()}</td>
                    <td className="p-2.5 text-center font-mono font-black text-purple-800">{s.currentBalance.toLocaleString()} {settings.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* Stock Counts Report */}
        {selectedReport === 'stock_counts' && (
          <div>
            <h3 className="text-sm font-black mb-3">تقرير جلسات جرد المخزون ({stockCounts.length})</h3>
            <div className="awlad-table-scroll">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 font-bold border-b">
                  <th className="p-2.5">رقم الجرد</th>
                  <th className="p-2.5">التاريخ</th>
                  <th className="p-2.5">المستودع</th>
                  <th className="p-2.5 text-center">عدد الأصناف</th>
                  <th className="p-2.5 text-center">صافي الفرق</th>
                  <th className="p-2.5 text-center">الحالة</th>
                  <th className="p-2.5">أنشئ بواسطة</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {stockCounts.length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-center text-slate-400">لا توجد جلسات جرد مسجلة.</td></tr>
                ) : stockCounts.map(c => {
                  const netDiff = (c.items || []).reduce((acc, it) => acc + it.varianceQty, 0);
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="p-2.5 font-mono font-bold text-blue-900">{c.countNumber}</td>
                      <td className="p-2.5 font-mono">{c.date}</td>
                      <td className="p-2.5 font-bold">{c.warehouseName}</td>
                      <td className="p-2.5 text-center font-mono">{c.items?.length || 0}</td>
                      <td className={`p-2.5 text-center font-mono font-black ${netDiff < 0 ? 'text-red-700' : netDiff > 0 ? 'text-emerald-700' : 'text-slate-600'}`}>{netDiff}</td>
                      <td className="p-2.5 text-center font-bold">{c.status}</td>
                      <td className="p-2.5">{c.counterName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* Stock Transfers Report */}
        {selectedReport === 'stock_transfers' && (
          <div>
            <h3 className="text-sm font-black mb-3">تقرير أوامر تحويل الأصناف المنظمة ({stockTransferRequests.length})</h3>
            <div className="awlad-table-scroll">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 font-bold border-b">
                  <th className="p-2.5">رقم التحويل</th>
                  <th className="p-2.5">التاريخ</th>
                  <th className="p-2.5">من مستودع</th>
                  <th className="p-2.5">إلى مستودع</th>
                  <th className="p-2.5 text-center">الأصناف</th>
                  <th className="p-2.5 text-center">الحالة</th>
                  <th className="p-2.5">السبب</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {stockTransferRequests.length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-center text-slate-400">لا توجد أوامر تحويل مسجلة.</td></tr>
                ) : stockTransferRequests.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="p-2.5 font-mono font-bold text-blue-900">{t.transferNumber}</td>
                    <td className="p-2.5 font-mono">{t.date}</td>
                    <td className="p-2.5 font-bold">{t.sourceWarehouseName}</td>
                    <td className="p-2.5 font-bold">{t.targetWarehouseName}</td>
                    <td className="p-2.5 text-center font-mono">{t.items?.length || 0}</td>
                    <td className="p-2.5 text-center font-bold">{t.status}</td>
                    <td className="p-2.5 text-slate-600">{t.reason || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* Owner Personal Accounts Report */}
        {selectedReport === 'personal_accounts' && canSeePersonalReport && (
          <div className="space-y-4">
            <h3 className="text-sm font-black">ملخص وحركات الحسابات الشخصية للملاك</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {ownerAccounts.map(acc => (
                <div key={acc.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-xs font-black text-slate-900">{acc.ownerName} — {acc.accountName}</div>
                  <div className="text-base font-black font-mono text-blue-950 mt-1">
                    {acc.currentBalance.toLocaleString()} {settings.currency}
                  </div>
                </div>
              ))}
            </div>
            <div className="awlad-table-scroll">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 font-bold border-b">
                  <th className="p-2.5">رقم الحركة</th>
                  <th className="p-2.5">التاريخ</th>
                  <th className="p-2.5">الحساب</th>
                  <th className="p-2.5">النوع</th>
                  <th className="p-2.5 text-center">المبلغ</th>
                  <th className="p-2.5">الخزينة</th>
                  <th className="p-2.5">البيان / السبب</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {ownerTransactions.length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-center text-slate-400">لا توجد معاملات مسجلة في الحسابات الشخصية.</td></tr>
                ) : ownerTransactions.map(tx => {
                  const acc = ownerAccounts.find(a => a.id === tx.accountId);
                  return (
                    <tr key={tx.id} className="hover:bg-slate-50">
                      <td className="p-2.5 font-mono font-bold text-blue-900">{tx.txNumber}</td>
                      <td className="p-2.5 font-mono">{tx.date}</td>
                      <td className="p-2.5 font-bold">{acc ? `${acc.ownerName} - ${acc.accountName}` : tx.accountId}</td>
                      <td className="p-2.5 font-bold">{tx.type}</td>
                      <td className="p-2.5 text-center font-mono font-black">{tx.amount.toLocaleString()}</td>
                      <td className="p-2.5 text-slate-600">{tx.cashboxName || 'مستقل (بدون خزينة)'}</td>
                      <td className="p-2.5 text-slate-600">{tx.reason || tx.notes || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
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

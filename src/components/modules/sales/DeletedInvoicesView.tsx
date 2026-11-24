import React, { useState, useMemo } from 'react';
import { Trash2, Search, Printer, Download, FileDown, Eye, ShieldAlert } from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { Invoice } from '../../../types';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';
import { exportTableToPdf } from '../../common/PdfExporter';

export const DeletedInvoicesView: React.FC = () => {
  const { invoices, settings } = useData();
  const [typeFilter, setTypeFilter] = useState<'all' | 'sales' | 'purchase'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [printData, setPrintData] = useState<PrintData | null>(null);

  const deletedInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (inv.status !== 'cancelled') return false;
      if (typeFilter !== 'all' && inv.type !== typeFilter) return false;
      if (dateFrom && inv.date < dateFrom) return false;
      if (dateTo && inv.date > dateTo) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        return (
          inv.invoiceNumber.toLowerCase().includes(q) ||
          (inv.customerName || '').toLowerCase().includes(q) ||
          (inv.supplierName || '').toLowerCase().includes(q) ||
          (inv.notes || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [invoices, typeFilter, searchTerm, dateFrom, dateTo]);

  const handlePrint = (inv: Invoice) => {
    setPrintData({
      title: `نسخة أرشيف فاتورة ملغاة (${inv.invoiceNumber})`,
      docNumber: inv.invoiceNumber,
      docType: inv.type === 'sales' ? 'فاتورة مبيعات' : 'فاتورة مشتريات',
      date: inv.date,
      partyName: inv.customerName || inv.supplierName || 'نقدي / عام',
      warehouseName: inv.warehouseName,
      items: inv.items.map((it) => ({
        name: it.productName,
        unit: it.unit,
        quantity: it.quantity,
        price: it.unitPrice,
        discount: it.discount,
        total: it.total,
      })),
      subtotal: inv.subtotal,
      discountTotal: inv.discountTotal,
      grandTotal: inv.grandTotal,
      paidAmount: inv.paidAmount,
      remainingAmount: inv.remainingAmount,
      notes: `ملغاة / محذوفة منطقياً | السبب والملاحظات: ${inv.notes || '-'}`,
    });
  };

  const handleExportExcel = () => {
    const headers = ['رقم الفاتورة', 'النوع', 'التاريخ', 'الطرف', 'المستودع', 'الإجمالي', 'المنشئ', 'سبب الإلغاء / الملاحظات'];
    const rows = deletedInvoices.map((inv) => [
      inv.invoiceNumber,
      inv.type === 'sales' ? 'مبيعات' : 'مشتريات',
      inv.date,
      inv.customerName || inv.supplierName || 'نقدي',
      inv.warehouseName,
      inv.grandTotal,
      inv.createdBy,
      inv.notes || '-',
    ]);
    exportToExcel(`سجل_الفواتير_المحذوفة_والملغاة_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  const handleExportPdf = () => {
    exportTableToPdf(
      'سجل الفواتير المحذوفة والملغاة (للمراجعة والتدقيق)',
      ['رقم الفاتورة', 'النوع', 'التاريخ', 'الطرف', 'الإجمالي', 'المنشئ', 'الملاحظات'],
      deletedInvoices.map((inv) => [
        inv.invoiceNumber,
        inv.type === 'sales' ? 'مبيعات' : 'مشتريات',
        inv.date,
        inv.customerName || inv.supplierName || 'نقدي',
        `${inv.grandTotal.toLocaleString()} ${settings.currency}`,
        inv.createdBy,
        inv.notes || '-',
      ]),
      {
        companyName: settings.companyName,
        subtitle: 'سجل التدقيق للفواتير الملغاة — محفوظة بالكامل دون حذف فعلي',
      }
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-700" />
            <span>سجل الفواتير المحذوفة والملغاة (Audit Review)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            مراجعة جميع فواتير البيع والشراء التي تم إلغاؤها أو حذفها منطقياً مع الاحتفاظ بكامل بياناتها وأسباب الإلغاء في الدفتر المركزي
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 cursor-pointer"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span>تصدير Excel</span>
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 border border-blue-200 text-blue-900 rounded-xl text-xs font-bold hover:bg-blue-100 cursor-pointer"
          >
            <FileDown className="w-4 h-4" />
            <span>تصدير PDF</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
        <div className="relative">
          <input
            type="text"
            placeholder="بحث برقم الفاتورة أو العميل أو السبب..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 rounded-xl py-2 pr-9 pl-3"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as any)}
          className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-bold"
        >
          <option value="all">كل الفواتير الملغاة (مبيعات ومشتريات)</option>
          <option value="sales">فواتير البيع الملغاة فقط</option>
          <option value="purchase">فواتير الشراء الملغاة فقط</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 font-mono"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead>
              <tr className="bg-red-50/70 text-red-950 font-bold border-b border-red-200">
                <th className="p-3.5">رقم الفاتورة</th>
                <th className="p-3.5">النوع</th>
                <th className="p-3.5">التاريخ</th>
                <th className="p-3.5">العميل / المورد</th>
                <th className="p-3.5">المستودع</th>
                <th className="p-3.5 text-center">القيمة الأصلية</th>
                <th className="p-3.5">منشئ الفاتورة</th>
                <th className="p-3.5">سبب الإلغاء والملاحظات</th>
                <th className="p-3.5 text-center">معاينة / طباعة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deletedInvoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-400">
                    لا توجد فواتير محذوفة أو ملغاة مطابقة للبحث.
                  </td>
                </tr>
              ) : (
                deletedInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-red-50/20">
                    <td className="p-3.5 font-mono font-bold text-red-800">{inv.invoiceNumber}</td>
                    <td className="p-3.5">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${inv.type === 'sales' ? 'bg-blue-100 text-blue-800' : 'bg-indigo-100 text-indigo-800'}`}>
                        {inv.type === 'sales' ? 'مبيعات' : 'مشتريات'}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono">{inv.date}</td>
                    <td className="p-3.5 font-bold">{inv.customerName || inv.supplierName || 'نقدي'}</td>
                    <td className="p-3.5">{inv.warehouseName}</td>
                    <td className="p-3.5 text-center font-mono font-black">{inv.grandTotal.toLocaleString()} {settings.currency}</td>
                    <td className="p-3.5">{inv.createdBy}</td>
                    <td className="p-3.5 text-slate-600">{inv.notes || 'تم إلغاء الفاتورة وعكس أثرها المخزني والمالي'}</td>
                    <td className="p-3.5 text-center">
                      <button
                        type="button"
                        onClick={() => handlePrint(inv)}
                        className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-slate-100 cursor-pointer"
                        title="معاينة / طباعة نسخة الأرشيف"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PrintDocumentModal isOpen={!!printData} onClose={() => setPrintData(null)} data={printData} />
    </div>
  );
};

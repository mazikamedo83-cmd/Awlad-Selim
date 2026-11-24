import React, { useState, useMemo } from 'react';
import { Trash2, Printer } from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { Invoice } from '../../../types';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';

export const DeletedInvoicesView: React.FC = () => {
  const { invoices, settings } = useData();
  const [typeFilter, setTypeFilter] = useState<'all' | 'sales' | 'purchase'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [printData, setPrintData] = useState<PrintData | null>(null);

  const deletedInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (inv.status !== 'cancelled') return false;
      if (typeFilter !== 'all' && inv.type !== typeFilter) return false;
      if (dateFrom && inv.date < dateFrom) return false;
      if (dateTo && inv.date > dateTo) return false;
      return true;
    });
  }, [invoices, typeFilter, dateFrom, dateTo]);

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

  return (
    <div className="space-y-4">
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-red-700" />
            <span>سجل الفواتير المحذوفة والملغاة (Audit Review)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            مراجعة جميع فواتير البيع والشراء التي تم إلغاؤها أو حذفها منطقياً مع الاحتفاظ بكامل بياناتها وأسباب الإلغاء في الدفتر المركزي
          </p>
        </div>
      </div>

      <UnifiedDataTable<Invoice>
        data={deletedInvoices}
        rowKey={(inv) => inv.id}
        searchPlaceholder="بحث برقم الفاتورة أو العميل أو السبب..."
        exportFilename="سجل-الفواتير-المحذوفة-والملغاة"
        pdfTitle="سجل الفواتير المحذوفة والملغاة (للمراجعة والتدقيق)"
        pdfExtra={{
          companyName: settings.companyName,
          subtitle: 'سجل التدقيق للفواتير الملغاة — محفوظة بالكامل دون حذف فعلي',
        }}
        emptyTitle="لا توجد فواتير محذوفة أو ملغاة مطابقة"
        toolbarFilters={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="min-h-[36px] bg-white border border-slate-300 rounded-lg px-2.5 py-1 font-bold"
            >
              <option value="all">كل الفواتير الملغاة</option>
              <option value="sales">فواتير البيع الملغاة فقط</option>
              <option value="purchase">فواتير الشراء الملغاة فقط</option>
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="min-h-[36px] bg-white border border-slate-300 rounded-lg px-2.5 py-1 font-mono"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="min-h-[36px] bg-white border border-slate-300 rounded-lg px-2.5 py-1 font-mono"
            />
          </div>
        }
        columns={[
          {
            key: 'invoiceNumber',
            header: 'رقم الفاتورة',
            align: 'right',
            sortValue: (inv) => inv.invoiceNumber,
            exportValue: (inv) => inv.invoiceNumber,
            render: (inv) => <span className="font-mono font-bold text-red-800">{inv.invoiceNumber}</span>,
          },
          {
            key: 'type',
            header: 'النوع',
            align: 'center',
            sortValue: (inv) => inv.type,
            exportValue: (inv) => (inv.type === 'sales' ? 'مبيعات' : 'مشتريات'),
            render: (inv) => (
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${inv.type === 'sales' ? 'bg-blue-50 text-blue-800 border-blue-200' : 'bg-indigo-50 text-indigo-800 border-indigo-200'}`}>
                {inv.type === 'sales' ? 'مبيعات' : 'مشتريات'}
              </span>
            ),
          },
          {
            key: 'date',
            header: 'التاريخ',
            align: 'center',
            sortValue: (inv) => inv.date,
            exportValue: (inv) => inv.date,
            render: (inv) => <span className="font-mono tabular-nums">{inv.date}</span>,
          },
          {
            key: 'party',
            header: 'العميل / المورد',
            align: 'right',
            sortValue: (inv) => inv.customerName || inv.supplierName || 'نقدي',
            exportValue: (inv) => inv.customerName || inv.supplierName || 'نقدي',
            render: (inv) => <span className="font-bold">{inv.customerName || inv.supplierName || 'نقدي'}</span>,
          },
          {
            key: 'warehouseName',
            header: 'المستودع',
            align: 'right',
            sortValue: (inv) => inv.warehouseName || '',
            exportValue: (inv) => inv.warehouseName || '',
            render: (inv) => <span>{inv.warehouseName}</span>,
          },
          {
            key: 'grandTotal',
            header: 'القيمة الأصلية',
            align: 'center',
            sortValue: (inv) => inv.grandTotal,
            exportValue: (inv) => inv.grandTotal,
            render: (inv) => (
              <span className="font-mono font-black tabular-nums">
                {inv.grandTotal.toLocaleString()} {settings.currency}
              </span>
            ),
          },
          {
            key: 'createdBy',
            header: 'منشئ الفاتورة',
            align: 'right',
            sortValue: (inv) => inv.createdBy,
            exportValue: (inv) => inv.createdBy,
            render: (inv) => <span>{inv.createdBy}</span>,
          },
          {
            key: 'notes',
            header: 'سبب الإلغاء والملاحظات',
            align: 'right',
            sortValue: (inv) => inv.notes || '',
            exportValue: (inv) => inv.notes || 'تم إلغاء الفاتورة وعكس أثرها المخزني والمالي',
            render: (inv) => (
              <span className="text-slate-600">{inv.notes || 'تم إلغاء الفاتورة وعكس أثرها المخزني والمالي'}</span>
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
                onClick={() => handlePrint(inv)}
                className="p-1.5 rounded-lg text-slate-600 hover:text-blue-900 hover:bg-slate-100 cursor-pointer"
                title="معاينة / طباعة نسخة الأرشيف"
              >
                <Printer className="w-4 h-4" />
              </button>
            ),
          },
        ]}
      />

      <PrintDocumentModal isOpen={!!printData} onClose={() => setPrintData(null)} data={printData} />
    </div>
  );
};


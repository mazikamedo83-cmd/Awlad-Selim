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
    <div className="space-y-2">
      <div className="bg-white px-2.5 py-2 rounded-lg border border-slate-200 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-1.5">
            <Trash2 className="w-4 h-4 text-red-700" />
            <span>سجل الفواتير المحذوفة والملغاة (Audit Review)</span>
          </h2>
          <p className="text-[11px] text-slate-500">
            مراجعة فواتير البيع والشراء الملغاة مع الاحتفاظ بكامل بياناتها وأسباب الإلغاء في الدفتر المركزي
          </p>
        </div>
      </div>

      <UnifiedDataTable<Invoice>
        data={deletedInvoices}
        compact
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
          <div className="flex flex-nowrap items-center gap-1.5 text-xs shrink-0">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="h-8 shrink-0 bg-white border border-slate-300 rounded-md px-2 font-bold"
            >
              <option value="all">كل الفواتير الملغاة</option>
              <option value="sales">فواتير البيع الملغاة فقط</option>
              <option value="purchase">فواتير الشراء الملغاة فقط</option>
            </select>
            <label className="inline-flex items-center gap-1 h-8 px-2 bg-white border border-slate-300 rounded-md shrink-0">
              <span className="text-[10.5px] font-bold text-slate-500">من:</span>
              <input
                type="date"
                aria-label="من تاريخ"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-transparent text-xs font-mono font-semibold outline-hidden"
              />
            </label>
            <label className="inline-flex items-center gap-1 h-8 px-2 bg-white border border-slate-300 rounded-md shrink-0">
              <span className="text-[10.5px] font-bold text-slate-500">إلى:</span>
              <input
                type="date"
                aria-label="إلى تاريخ"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-transparent text-xs font-mono font-semibold outline-hidden"
              />
            </label>
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
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${inv.type === 'sales' ? 'bg-[#EEF3FA] text-[#011E58] border-[#DCE6F5]' : 'bg-[#DCE6F5] text-[#003589] border-[#B8CAE8]'}`}>
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
                className="p-1 rounded-md text-slate-600 hover:text-blue-900 hover:bg-slate-100 cursor-pointer"
                title="معاينة / طباعة نسخة الأرشيف"
              >
                <Printer className="w-3.5 h-3.5" />
              </button>
            ),
          },
        ]}
      />

      <PrintDocumentModal isOpen={!!printData} onClose={() => setPrintData(null)} data={printData} />
    </div>
  );
};


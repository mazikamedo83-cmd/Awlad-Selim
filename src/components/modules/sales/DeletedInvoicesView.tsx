import React, { useState, useMemo } from 'react';
import { Trash2, Printer } from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import { Invoice } from '../../../types';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';

export const DeletedInvoicesView: React.FC = () => {
  const { invoices, settings } = useData();
  const { t, locale } = usePreferences();
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
      title: t(`نسخة أرشيف فاتورة ملغاة (${inv.invoiceNumber})`, `Cancelled Invoice Archive Copy (${inv.invoiceNumber})`),
      docNumber: inv.invoiceNumber,
      docType: inv.type === 'sales' ? t('فاتورة مبيعات', 'Sales Invoice') : t('فاتورة مشتريات', 'Purchase Invoice'),
      date: inv.date,
      partyName: inv.customerName || inv.supplierName || t('نقدي / عام', 'Cash / General'),
      warehouseName: inv.warehouseName ? t(inv.warehouseName) : undefined,
      items: inv.items.map((it) => ({
        name: it.productName,
        unit: t(it.unit),
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
      notes: t(
        `ملغاة / محذوفة منطقياً | السبب والملاحظات: ${inv.notes || '-'}`,
        `Cancelled / Soft-deleted | Reason & Notes: ${inv.notes || '-'}`
      ),
    });
  };

  return (
    <div className="space-y-2">
      <div className="bg-white px-2.5 py-2 rounded-lg border border-slate-200 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-slate-900 tracking-tight flex items-center gap-1.5">
            <Trash2 className="w-4 h-4 text-red-700" />
            <span>{t('سجل الفواتير المحذوفة والملغاة (Audit Review)', 'Deleted & Cancelled Invoices Log (Audit Review)')}</span>
          </h2>
          <p className="text-[11px] text-slate-500">
            {t(
              'مراجعة فواتير البيع والشراء الملغاة مع الاحتفاظ بكامل بياناتها وأسباب الإلغاء في الدفتر المركزي',
              'Review cancelled sales and purchase invoices with full details and cancellation reasons retained in the central ledger'
            )}
          </p>
        </div>
      </div>

      <UnifiedDataTable<Invoice>
        data={deletedInvoices}
        compact
        rowKey={(inv) => inv.id}
        searchPlaceholder={t('بحث برقم الفاتورة أو العميل أو السبب...', 'Search by invoice #, customer, or reason...')}
        exportFilename={t('سجل-الفواتير-المحذوفة-والملغاة', 'Deleted-Cancelled-Invoices-Log')}
        pdfTitle={t('سجل الفواتير المحذوفة والملغاة (للمراجعة والتدقيق)', 'Deleted & Cancelled Invoices Log (Audit Review)')}
        pdfExtra={{
          companyName: settings.companyName,
          subtitle: t(
            'سجل التدقيق للفواتير الملغاة — محفوظة بالكامل دون حذف فعلي',
            'Audit log for cancelled invoices — fully preserved without hard deletion'
          ),
        }}
        emptyTitle={t('لا توجد فواتير محذوفة أو ملغاة مطابقة', 'No matching deleted or cancelled invoices')}
        toolbarFilters={
          <div className="flex flex-nowrap items-center gap-1.5 text-xs shrink-0">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="h-8 shrink-0 bg-white border border-slate-300 rounded-md px-2 font-bold"
            >
              <option value="all">{t('كل الفواتير الملغاة', 'All Cancelled Invoices')}</option>
              <option value="sales">{t('فواتير البيع الملغاة فقط', 'Cancelled Sales Only')}</option>
              <option value="purchase">{t('فواتير الشراء الملغاة فقط', 'Cancelled Purchases Only')}</option>
            </select>
            <label className="inline-flex items-center gap-1 h-8 px-2 bg-white border border-slate-300 rounded-md shrink-0">
              <span className="text-[10.5px] font-bold text-slate-500">{t('من:', 'From:')}</span>
              <input
                type="date"
                aria-label={t('من تاريخ', 'From date')}
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-transparent text-xs font-mono font-semibold outline-hidden"
              />
            </label>
            <label className="inline-flex items-center gap-1 h-8 px-2 bg-white border border-slate-300 rounded-md shrink-0">
              <span className="text-[10.5px] font-bold text-slate-500">{t('إلى:', 'To:')}</span>
              <input
                type="date"
                aria-label={t('إلى تاريخ', 'To date')}
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
            header: t('رقم الفاتورة', 'Invoice #'),
            sortValue: (inv) => inv.invoiceNumber,
            exportValue: (inv) => inv.invoiceNumber,
            render: (inv) => <span className="font-mono font-bold text-red-800">{inv.invoiceNumber}</span>,
          },
          {
            key: 'type',
            header: t('النوع', 'Type'),
            align: 'center',
            sortValue: (inv) => inv.type,
            exportValue: (inv) => (inv.type === 'sales' ? t('مبيعات', 'Sales') : t('مشتريات', 'Purchases')),
            render: (inv) => (
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${inv.type === 'sales' ? 'bg-[#EEF3FA] text-[#011E58] border-[#DCE6F5]' : 'bg-[#DCE6F5] text-[#003589] border-[#B8CAE8]'}`}>
                {inv.type === 'sales' ? t('مبيعات', 'Sales') : t('مشتريات', 'Purchases')}
              </span>
            ),
          },
          {
            key: 'date',
            header: t('التاريخ', 'Date'),
            align: 'center',
            sortValue: (inv) => inv.date,
            exportValue: (inv) => inv.date,
            render: (inv) => <span className="font-mono tabular-nums">{inv.date}</span>,
          },
          {
            key: 'party',
            header: t('العميل / المورد', 'Customer / Supplier'),
            sortValue: (inv) => inv.customerName || inv.supplierName || t('نقدي', 'Cash'),
            exportValue: (inv) => inv.customerName || inv.supplierName || t('نقدي', 'Cash'),
            render: (inv) => <span className="font-bold">{inv.customerName || inv.supplierName || t('نقدي', 'Cash')}</span>,
          },
          {
            key: 'warehouseName',
            header: t('المستودع', 'Warehouse'),
            sortValue: (inv) => inv.warehouseName || '',
            exportValue: (inv) => (inv.warehouseName ? t(inv.warehouseName) : ''),
            render: (inv) => <span>{inv.warehouseName ? t(inv.warehouseName) : ''}</span>,
          },
          {
            key: 'grandTotal',
            header: t('القيمة الأصلية', 'Original Total'),
            align: 'center',
            sortValue: (inv) => inv.grandTotal,
            exportValue: (inv) => inv.grandTotal,
            render: (inv) => (
              <span className="font-mono font-black tabular-nums">
                {formatLocaleNumber(inv.grandTotal)} {t(settings.currency)}
              </span>
            ),
          },
          {
            key: 'createdBy',
            header: t('منشئ الفاتورة', 'Created By'),
            sortValue: (inv) => inv.createdBy,
            exportValue: (inv) => inv.createdBy,
            render: (inv) => <span>{inv.createdBy}</span>,
          },
          {
            key: 'notes',
            header: t('سبب الإلغاء والملاحظات', 'Cancellation Reason & Notes'),
            sortValue: (inv) => inv.notes || '',
            exportValue: (inv) => inv.notes || t('تم إلغاء الفاتورة وعكس أثرها المخزني والمالي', 'Invoice cancelled and inventory/financial impact reversed'),
            render: (inv) => (
              <span className="text-slate-600">{inv.notes || t('تم إلغاء الفاتورة وعكس أثرها المخزني والمالي', 'Invoice cancelled and inventory/financial impact reversed')}</span>
            ),
          },
          {
            key: 'actions',
            header: t('الإجراءات', 'Actions'),
            align: 'center',
            sortable: false,
            render: (inv) => (
              <button
                type="button"
                onClick={() => handlePrint(inv)}
                className="p-1 rounded-md text-slate-600 hover:text-blue-900 hover:bg-slate-100 cursor-pointer"
                title={t('معاينة / طباعة نسخة الأرشيف', 'Preview / Print archive copy')}
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

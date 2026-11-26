import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  RotateCcw,
  RefreshCw,
  Printer,
  Download,
  FileDown,
  Warehouse as WarehouseIcon,
  Truck,
  Eye,
  Package,
  TrendingUp,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import { ItemMovementReportResponse, ItemMovementRow } from '../../../types';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';
import { exportTableToPdf } from '../../common/PdfExporter';
import { Modal } from '../../common/Modal';
import { SearchableFilterSelect, type SearchableFilterOption } from '../../common/SearchableFilterSelect';
import { UnifiedDataTable, type UnifiedColumn } from '../../common/UnifiedDataTable';

export interface ItemMovementReportProps {
  initialProductId?: string | null;
}

type SectionKey = keyof ItemMovementReportResponse['sections'];

const DOC_TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  sales_invoice: { ar: 'فاتورة مبيعات', en: 'Sales Invoice' },
  purchase_invoice: { ar: 'فاتورة مشتريات', en: 'Purchase Invoice' },
  sales_return: { ar: 'مرتجع مبيعات', en: 'Sales Return' },
  purchase_return: { ar: 'مرتجع مشتريات', en: 'Purchase Return' },
  custody_sent: { ar: 'صرف عهدة مندوب', en: 'Rep Custody Dispatched' },
  custody_received: { ar: 'استلام عهدة مندوب', en: 'Rep Custody Received' },
  delivered_to_customer: { ar: 'تسليم من العهدة للعميل', en: 'Delivered from Custody' },
  returned_to_warehouse: { ar: 'رد عهدة للمخزن', en: 'Returned Custody to Warehouse' },
  transfer_in: { ar: 'تحويل مخزني وارد', en: 'Stock Transfer In' },
  transfer_out: { ar: 'تحويل مخزني صادر', en: 'Stock Transfer Out' },
  opening_balance: { ar: 'رصيد أول المدة', en: 'Opening Balance' },
  adjustment: { ar: 'تسوية / جرد مخزني', en: 'Stock Adjustment / Count' },
  damaged: { ar: 'تالف / منتهي الصلاحية', en: 'Damaged / Expired' },
  custody_damaged: { ar: 'تالف عهدة مندوب', en: 'Rep Custody Damaged' },
  custody_shortage: { ar: 'عجز عهدة مندوب', en: 'Rep Custody Shortage' },
  custody_adjustment: { ar: 'تسوية عهدة مندوب', en: 'Rep Custody Adjustment' },
  sale_edit: { ar: 'تعديل فاتورة مبيعات', en: 'Sales Invoice Edit' },
  purchase_edit: { ar: 'تعديل فاتورة مشتريات', en: 'Purchase Invoice Edit' },
  sale_cancel: { ar: 'إلغاء فاتورة مبيعات', en: 'Sales Invoice Cancel' },
  purchase_cancel: { ar: 'إلغاء فاتورة مشتريات', en: 'Purchase Invoice Cancel' },
};

const SECTION_META: Array<{
  key: SectionKey;
  title: string;
  titleEn: string;
  subtitle: string;
  subtitleEn: string;
  bannerCls: string;
  badgeCls: string;
}> = [
  {
    key: 'sales',
    title: '1. فواتير المبيعات المعتمدة',
    titleEn: '1. Approved Sales Invoices',
    subtitle: 'المبيعات الفعلية واحتساب الربحية بناءً على التكلفة',
    subtitleEn: 'Actual sales and cost-based profitability calculation',
    bannerCls: 'bg-[#011E58] text-white border-[#002160]',
    badgeCls: 'bg-[#003589] text-[#DCE6F5]',
  },
  {
    key: 'purchases',
    title: '2. فواتير المشتريات والتوريدات',
    titleEn: '2. Purchase Invoices & Supplies',
    subtitle: 'الكميات المضافة للمخزون من الموردين وتكلفة الشراء',
    subtitleEn: 'Quantities added to stock from suppliers and purchase cost',
    bannerCls: 'bg-[#002160] text-white border-[#011E58]',
    badgeCls: 'bg-[#003589] text-[#DCE6F5]',
  },
  {
    key: 'sales_returns',
    title: '3. مرتجعات المبيعات',
    titleEn: '3. Sales Returns',
    subtitle: 'الكميات المرتجعة من العملاء وإضافتها للمخزن',
    subtitleEn: 'Quantities returned from customers and restored to warehouse',
    bannerCls: 'bg-amber-800 text-white border-amber-700',
    badgeCls: 'bg-amber-700 text-amber-100',
  },
  {
    key: 'purchase_returns',
    title: '4. مرتجعات المشتريات',
    titleEn: '4. Purchase Returns',
    subtitle: 'الكميات المرتجعة للموردين وخصمها من المخزن',
    subtitleEn: 'Quantities returned to suppliers and deducted from warehouse',
    bannerCls: 'bg-amber-900 text-white border-amber-800',
    badgeCls: 'bg-amber-800 text-amber-100',
  },
  {
    key: 'transfers',
    title: '5. التحويلات المخزنية بين المستودعات',
    titleEn: '5. Inter-Warehouse Stock Transfers',
    subtitle: 'حركات نقل داخلي مستبعدة من إجمالي المبيعات',
    subtitleEn: 'Internal stock movements excluded from total sales',
    bannerCls: 'bg-[#003589] text-white border-[#002160]',
    badgeCls: 'bg-[#011E58] text-[#DCE6F5]',
  },
  {
    key: 'custody_sent',
    title: '6. صرف عهدة البضاعة من المخزن للمندوب',
    titleEn: '6. Custody Dispatch from Warehouse to Rep',
    subtitle: 'أذونات الصرف الصادرة من المستودع الرئيسي للمناديب',
    subtitleEn: 'Dispatch notes issued from main warehouse to representatives',
    bannerCls: 'bg-[#0049B0] text-white border-[#003589]',
    badgeCls: 'bg-[#011E58] text-[#DCE6F5]',
  },
  {
    key: 'custody_received',
    title: '7. استلام العهدة في سيارات المناديب',
    titleEn: '7. Custody Receipt in Rep Vehicles',
    subtitle: 'الأذونات المؤكد استلامها فعلياً في عهدة سيارة المندوب',
    subtitleEn: 'Notes confirmed as physically received in rep vehicle custody',
    bannerCls: 'bg-[#011E58] text-white border-[#003589]',
    badgeCls: 'bg-[#0049B0] text-white',
  },
  {
    key: 'custody_deliveries',
    title: '8. تسليمات وإرجاعات عهدة المناديب',
    titleEn: '8. Rep Custody Deliveries & Returns',
    subtitle: 'التسليم الجزئي للعملاء أو الإرجاع من السيارة للمخزن',
    subtitleEn: 'Partial delivery to customers or return from vehicle to warehouse',
    bannerCls: 'bg-slate-800 text-white border-slate-700',
    badgeCls: 'bg-slate-700 text-slate-100',
  },
  {
    key: 'adjustments',
    title: '9. تسويات الجرد والتالف والعجز',
    titleEn: '9. Stock Count Adjustments, Damages & Shortages',
    subtitle: 'الرصيد الافتتاحي، تسويات الجرد، التوالف، وتسويات العهد',
    subtitleEn: 'Opening balance, count adjustments, damages, and custody settlements',
    bannerCls: 'bg-rose-900 text-white border-rose-800',
    badgeCls: 'bg-rose-800 text-rose-100',
  },
];

export const ItemMovementReport: React.FC<ItemMovementReportProps> = ({ initialProductId }) => {
  const {
    products,
    warehouses,
    representatives,
    invoices,
    invoiceReturns,
    repItemTransfers = [],
    stockTransferRequests = [],
    repCustodyOperations = [],
    settings,
    getItemMovementReport,
  } = useData();

  const { t, isRtl } = usePreferences();
  const arrow = isRtl ? '⬅' : '→';
  const currency = t(settings.currency);
  const formatDocTypeLabel = useCallback(
    (docType?: string) => {
      if (!docType) return '-';
      const mapped = DOC_TYPE_LABELS[docType];
      return mapped ? t(mapped.ar, mapped.en) : t(docType);
    },
    [t]
  );

  const [productId, setProductId] = useState<string>(initialProductId || 'all');
  const [warehouseId, setWarehouseId] = useState<string>('all');
  const [representativeId, setRepresentativeId] = useState<string>('all');
  const [movementType, setMovementType] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  const [report, setReport] = useState<ItemMovementReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<ItemMovementRow | null>(null);

  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [isPrintOpen, setIsPrintOpen] = useState(false);

  const productFilterOptions = useMemo<SearchableFilterOption[]>(
    () =>
      products.map((p) => {
        const stockQty =
          warehouseId !== 'all'
            ? Number(p.stockPerWarehouse?.[warehouseId] || 0)
            : Object.values(p.stockPerWarehouse || {}).reduce((s, v) => s + Number(v || 0), 0);
        return {
          value: p.id,
          label: p.name,
          subtitle: `${p.code}${p.barcode ? ` • ${p.barcode}` : ''} • ${t('الرصيد:', 'Balance:')} ${formatLocaleNumber(stockQty)} ${t(p.baseUnit)}`,
          badge: p.code,
          searchText: `${p.code} ${p.barcode || ''} ${p.category || ''}`,
        };
      }),
    [products, warehouseId, t]
  );

  const warehouseFilterOptions = useMemo<SearchableFilterOption[]>(
    () =>
      warehouses.map((w) => ({
        value: w.id,
        label: w.name,
        subtitle: w.code,
        searchText: w.code || '',
      })),
    [warehouses]
  );

  const representativeFilterOptions = useMemo<SearchableFilterOption[]>(
    () =>
      representatives.map((r) => ({
        value: r.id,
        label: r.name,
        subtitle: r.phone || undefined,
        searchText: r.phone || '',
      })),
    [representatives]
  );

  const movementSectionFilterOptions = useMemo<SearchableFilterOption[]>(
    () =>
      SECTION_META.map((sec) => ({
        value: sec.key,
        label: t(sec.title, sec.titleEn),
        subtitle: t(sec.subtitle, sec.subtitleEn),
      })),
    [t]
  );

  useEffect(() => {
    if (initialProductId) {
      setProductId(initialProductId);
    }
  }, [initialProductId]);

  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const res = await getItemMovementReport({
      productId: productId || 'all',
      warehouseId: warehouseId || 'all',
      representativeId: representativeId || 'all',
      movementType: movementType || 'all',
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      search: search.trim() || undefined,
    });
    setIsLoading(false);
    if (!res.success || !res.report) {
      setError(res.error ? t(res.error) : t('تعذر تحميل تقرير حركة الصنف', 'Unable to load item movement report'));
    } else {
      setReport(res.report);
    }
  }, [productId, warehouseId, representativeId, movementType, dateFrom, dateTo, search, getItemMovementReport, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchReport();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [fetchReport]);

  const handleResetFilters = () => {
    setProductId('all');
    setWarehouseId('all');
    setRepresentativeId('all');
    setMovementType('all');
    setDateFrom('');
    setDateTo('');
    setSearch('');
  };

  const visibleSections = useMemo(() => {
    if (!report) return [];
    return SECTION_META.filter((sec) => {
      if (movementType !== 'all' && sec.key !== movementType) return false;
      return (report.sections[sec.key] || []).length > 0;
    });
  }, [report, movementType]);

  const buildGroupedExportRows = (): { headers: string[]; rows: Array<Array<string | number>> } => {
    const headers = [
      t('القسم / نوع الحركة', 'Section / Movement Type'),
      t('التاريخ', 'Date'),
      t('رقم المستند', 'Document #'),
      t('الصنف', 'Item'),
      t('المستودع / المسار', 'Warehouse / Route'),
      t('الطرف / المندوب', 'Party / Rep'),
      t('الوحدة', 'Unit'),
      t('الكمية', 'Quantity'),
      t('سعر الوحدة', 'Unit Price'),
      t('سعر التكلفة', 'Cost Price'),
      t('الإجمالي', 'Total'),
      t('الربح (على التكلفة)', 'Profit (on Cost)'),
      t('ملاحظات', 'Notes'),
    ];
    const rows: Array<Array<string | number>> = [];
    if (!report) return { headers, rows };

    visibleSections.forEach((sec) => {
      const list = report.sections[sec.key] || [];
      rows.push([`=== ${t(sec.title, sec.titleEn)} (${list.length}) ===`, '', '', '', '', '', '', '', '', '', '', '', '']);
      list.forEach((r) => {
        rows.push([
          formatDocTypeLabel(r.docType),
          r.date,
          r.docNumber,
          r.productName,
          r.targetWarehouseName ? `${r.warehouseName || ''} ${arrow} ${r.targetWarehouseName}` : r.warehouseName || '-',
          r.partyName || r.representativeName || '-',
          t(r.unit),
          r.quantity,
          r.unitPrice,
          r.costPrice,
          r.totalValue,
          r.profitValue,
          r.notes || '-',
        ]);
      });
    });

    return { headers, rows };
  };

  const handleExportExcel = () => {
    const { headers, rows } = buildGroupedExportRows();
    const label = report?.product ? report.product.name : t('كل_الأصناف', 'All_Items');
    exportToExcel(`${t('تقرير_حركة_الصنف', 'Item_Movement_Report')}_${label}_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  const handleExportPdf = () => {
    if (!report) return;
    const { headers, rows } = buildGroupedExportRows();
    exportTableToPdf(
      `${t('تقرير حركة الصنف المفصل', 'Detailed Item Movement Report')}${report.product ? ` — ${report.product.name}` : ''}`,
      headers,
      rows,
      {
        companyName: settings.companyName,
        companySubtitle: settings.companySubtitle,
        dateRangeText: `${dateFrom || t('البداية', 'Start')} ${t('إلى', 'to')} ${dateTo || t('اليوم', 'Today')}`,
        summaryPairs: [
          { label: t('إجمالي المبيعات', 'Total Sales'), value: `${formatLocaleNumber(report.totals.totalSalesValue)} ${currency}` },
          { label: t('إجمالي المشتريات', 'Total Purchases'), value: `${formatLocaleNumber(report.totals.totalPurchaseValue)} ${currency}` },
          { label: t('الربح المبني على التكلفة', 'Cost-Based Profit'), value: `${formatLocaleNumber(report.totals.totalProfit)} ${currency}`, highlight: true },
          { label: t('الرصيد الحالي وتقييم المخزون', 'Current Balance & Stock Valuation'), value: `${formatLocaleNumber(report.totals.currentBalance)} (${formatLocaleNumber(report.totals.inventoryValuation)} ${currency})` },
        ],
      }
    );
  };

  const handlePrint = () => {
    if (!report) return;
    const items: PrintData['items'] = [];
    visibleSections.forEach((sec) => {
      const list = report.sections[sec.key] || [];
      items.push({
        name: `--- ${t(sec.title, sec.titleEn)} ---`,
        unit: '-',
        quantity: list.length,
        price: 0,
        total: list.reduce((s, r) => s + Number(r.totalValue || 0), 0),
      });
      list.forEach((r) => {
        items.push({
          name: `${r.date} | ${r.docNumber} | ${r.productName}${r.partyName ? ` (${r.partyName})` : ''}`,
          unit: t(r.unit),
          quantity: r.quantity,
          price: r.unitPrice,
          discount: r.profitValue,
          total: r.totalValue,
        });
      });
    });

    setPrintData({
      title: `${t('تقرير حركة الصنف المفصل', 'Detailed Item Movement Report')}${report.product ? ` — ${report.product.name}` : ''}`,
      docNumber: report.product?.code || 'ALL-ITEMS',
      docType: 'كشف حساب',
      date: `${dateFrom || t('بداية النشاط', 'Inception')} ${t('إلى', 'to')} ${dateTo || t('اليوم', 'Today')}`,
      partyName: report.product ? `${report.product.name} (${report.product.code})` : t('جميع الأصناف', 'All Items'),
      warehouseName: warehouseId === 'all' ? t('جميع المستودعات', 'All Warehouses') : warehouses.find((w) => w.id === warehouseId)?.name,
      representativeName: representativeId === 'all' ? t('جميع المناديب', 'All Representatives') : representatives.find((r) => r.id === representativeId)?.name,
      tableHeaders: [t('م', '#'), t('القسم / المستند والصنف', 'Section / Doc & Item'), t('الوحدة', 'Unit'), t('الكمية', 'Qty'), t('السعر', 'Price'), t('الربح', 'Profit'), t('الإجمالي', 'Total')],
      items,
      grandTotal: report.totals.totalSalesValue,
      paidAmount: report.totals.totalPurchaseValue,
      remainingAmount: report.totals.totalProfit,
      notes: `${t('إجمالي الوارد:', 'Total In:')} ${formatLocaleNumber(report.totals.totalQtyIn)} | ${t('إجمالي المنصرف:', 'Total Out:')} ${formatLocaleNumber(report.totals.totalQtyOut)} | ${t('الرصيد الحالي:', 'Current Balance:')} ${formatLocaleNumber(report.totals.currentBalance)} | ${t('تقييم المخزون بالتكلفة:', 'Stock Valuation at Cost:')} ${formatLocaleNumber(report.totals.inventoryValuation)} ${currency}`,
    });
    setIsPrintOpen(true);
  };

  // Lookup source document for clicked row
  const sourceDocDetails = useMemo(() => {
    if (!selectedRow) return null;
    const inv = invoices.find((i) => i.id === selectedRow.docId);
    if (inv) return { kind: 'invoice' as const, data: inv };
    const ret = invoiceReturns.find((r) => r.id === selectedRow.docId);
    if (ret) return { kind: 'return' as const, data: ret };
    const repReq = repItemTransfers.find((tr) => tr.id === selectedRow.docId);
    if (repReq) return { kind: 'rep_transfer' as const, data: repReq };
    const stReq = stockTransferRequests.find((tr) => tr.id === selectedRow.docId);
    if (stReq) return { kind: 'stock_transfer' as const, data: stReq };
    const custodyOp = repCustodyOperations.find((op) => op.id === selectedRow.docId);
    if (custodyOp) return { kind: 'rep_custody' as const, data: custodyOp };
    return null;
  }, [selectedRow, invoices, invoiceReturns, repItemTransfers, stockTransferRequests, repCustodyOperations]);

  const handlePrintSelectedSourceDoc = () => {
    if (!selectedRow) return;
    const defaultHeaders = [t('م', '#'), t('الصنف', 'Item'), t('الوحدة', 'Unit'), t('الكمية', 'Qty'), t('السعر', 'Price'), t('الخصم', 'Discount'), t('الإجمالي', 'Total')];
    if (sourceDocDetails?.kind === 'invoice') {
      const inv = sourceDocDetails.data;
      setPrintData({
        title: inv.type === 'purchase' ? t('فاتورة مشتريات', 'Purchase Invoice') : inv.type === 'quote' ? t('عرض سعر', 'Quotation') : t('فاتورة مبيعات', 'Sales Invoice'),
        docNumber: inv.invoiceNumber,
        docType: inv.type === 'purchase' ? 'فاتورة مشتريات' : inv.type === 'quote' ? 'عرض سعر' : 'فاتورة مبيعات',
        date: inv.date,
        partyName: inv.supplierName || inv.customerName || '-',
        warehouseName: inv.warehouseName,
        representativeName: inv.representativeName,
        tableHeaders: defaultHeaders,
        items: (inv.items || []).map((it) => ({
          name: it.productName,
          unit: t(it.unit),
          quantity: it.quantity,
          price: it.unitPrice,
          discount: it.discount,
          total: it.total,
        })),
        grandTotal: inv.grandTotal,
        paidAmount: inv.paidAmount,
        remainingAmount: inv.remainingAmount,
        notes: inv.notes,
      });
    } else if (sourceDocDetails?.kind === 'return') {
      const ret = sourceDocDetails.data;
      setPrintData({
        title: ret.type === 'purchase_return' ? t('إشعار مرتجع مشتريات', 'Purchase Return Notice') : t('إشعار مرتجع مبيعات', 'Sales Return Notice'),
        docNumber: ret.returnNumber,
        docType: ret.type === 'purchase_return' ? 'مرتجع مشتريات' : 'مرتجع مبيعات',
        date: ret.date,
        partyName: ret.partyName,
        warehouseName: ret.warehouseName,
        tableHeaders: defaultHeaders,
        items: (ret.items || []).map((it) => ({
          name: it.productName,
          unit: t(it.unit),
          quantity: it.quantity,
          price: it.unitPrice,
          total: it.total,
        })),
        grandTotal: ret.grandTotal,
        notes: ret.reason,
      });
    } else if (sourceDocDetails?.kind === 'rep_transfer') {
      const repTr = sourceDocDetails.data;
      setPrintData({
        title: t('إذن صرف / تحويل عهدة مندوب', 'Rep Custody Dispatch / Transfer Note'),
        docNumber: repTr.requestNumber,
        docType: repTr.status === 'received' ? 'إيصال استلام' : 'سند صرف',
        date: repTr.date,
        partyName: repTr.representativeName,
        warehouseName: `${repTr.sourceWarehouseName} ${arrow} ${repTr.targetWarehouseName}`,
        representativeName: repTr.representativeName,
        tableHeaders: [t('م', '#'), t('الصنف', 'Item'), t('الوحدة', 'Unit'), t('الكمية المنفذة', 'Executed Qty'), t('السعر', 'Price'), t('الخصم', 'Discount'), t('الإجمالي', 'Total')],
        items: (repTr.items || []).map((it) => ({
          name: it.productName,
          unit: t(it.unit),
          quantity: it.executedQty ?? it.approvedQty ?? it.requestedQty,
          price: 0,
          total: 0,
        })),
        grandTotal: selectedRow.totalValue,
        notes: repTr.notes,
      });
    } else if (sourceDocDetails?.kind === 'stock_transfer') {
      const st = sourceDocDetails.data;
      setPrintData({
        title: t('مستند تحويل مخزني', 'Stock Transfer Document'),
        docNumber: st.transferNumber,
        docType: 'سند صرف',
        date: st.date,
        warehouseName: `${st.sourceWarehouseName} ${arrow} ${st.targetWarehouseName}`,
        tableHeaders: defaultHeaders,
        items: (st.items || []).map((it) => ({
          name: it.productName,
          unit: t(it.unit),
          quantity: it.executedQty ?? it.requestedQty,
          price: 0,
          total: 0,
        })),
        grandTotal: selectedRow.totalValue,
        notes: st.reason,
      });
    } else {
      const fallbackDocType: PrintData['docType'] =
        selectedRow.direction === 'in' ? 'إيصال استلام' : selectedRow.direction === 'out' ? 'سند صرف' : 'كشف حساب';
      setPrintData({
        title: `${t('تفاصيل مستند حركة الصنف', 'Item Movement Document Details')} (${formatDocTypeLabel(selectedRow.docType)})`,
        docNumber: selectedRow.docNumber,
        docType: fallbackDocType,
        date: selectedRow.date,
        partyName: selectedRow.partyName || selectedRow.representativeName || '-',
        warehouseName: selectedRow.targetWarehouseName
          ? `${selectedRow.warehouseName || ''} ${arrow} ${selectedRow.targetWarehouseName}`
          : selectedRow.warehouseName,
        representativeName: selectedRow.representativeName,
        tableHeaders: defaultHeaders,
        items: [
          {
            name: selectedRow.productName,
            unit: t(selectedRow.unit),
            quantity: selectedRow.quantity,
            price: selectedRow.unitPrice,
            total: selectedRow.totalValue,
          },
        ],
        grandTotal: selectedRow.totalValue,
        notes: selectedRow.notes,
      });
    }
    setIsPrintOpen(true);
  };

  return (
    <div className="space-y-2">
      {/* Header & Exports */}
      <div className="bg-white px-2.5 py-2 rounded-lg border border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-black text-slate-900">{t('تقرير حركة الصنف المفصل والشامل', 'Comprehensive Item Movement Report')}</h3>
          <p className="text-[11px] text-slate-500">
            {t(
              'متابعة المبيعات والمشتريات والمرتجعات والتحويلات وعهد المناديب والتسويات مع احتساب الأرباح على التكلفة وتقييم المخزون',
              'Track sales, purchases, returns, transfers, rep custody, and adjustments with cost-based profit and inventory valuation'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={!report}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-50 font-bold text-slate-700 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={!report}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-200 bg-red-50 hover:bg-red-100 font-bold text-red-800 cursor-pointer disabled:opacity-50"
          >
            <FileDown className="w-3.5 h-3.5 text-red-700" />
            <span>PDF</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!report}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#003589] hover:bg-[#011E58] text-white font-black cursor-pointer disabled:opacity-50"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{t('طباعة التقرير', 'Print Report')}</span>
          </button>
        </div>
      </div>

      {/* Unified Single-Row Multi-Filter Toolbar */}
      <div className="bg-white dark:bg-[#0E1C36] p-2 rounded-lg border border-slate-200 dark:border-[#21375C] text-xs">
        <div className="awlad-filter-row pb-0.5" data-testid="imr-single-filter-row">
          <div className="relative w-[170px] shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-[#8CA3C7] absolute start-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              aria-label={t('بحث في المستندات أو الأطراف', 'Search documents or parties')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('بحث (فاتورة / طرف / ملاحظات)...', 'Search (invoice / party / notes)...')}
              className="w-full h-8 ps-7 pe-2 rounded-md border border-slate-300 dark:border-[#2A436E] text-xs bg-slate-50 dark:bg-[#10203D] focus:bg-white focus:outline-none"
            />
          </div>

          <div className="w-[155px] shrink-0">
            <SearchableFilterSelect
              id="imr-filter-product"
              inlinePrefix={t('الصنف', 'Item')}
              value={productId}
              onChange={setProductId}
              options={productFilterOptions}
              allOptionLabel={t('جميع الأصناف', 'All Items')}
              allOptionValue="all"
              searchPlaceholder={t('ابحث باسم الصنف أو الكود أو الباركود...', 'Search by item name, code, or barcode...')}
              allowClear
              minPanelWidth={280}
              buttonClassName="rounded-md h-8"
            />
          </div>

          <div className="w-[135px] shrink-0">
            <SearchableFilterSelect
              id="imr-filter-warehouse"
              inlinePrefix={t('المستودع', 'Warehouse')}
              value={warehouseId}
              onChange={setWarehouseId}
              options={warehouseFilterOptions}
              allOptionLabel={t('جميع المستودعات', 'All Warehouses')}
              allOptionValue="all"
              allowClear
              buttonClassName="rounded-md h-8"
            />
          </div>

          <div className="w-[135px] shrink-0">
            <SearchableFilterSelect
              id="imr-filter-rep"
              inlinePrefix={t('المندوب', 'Rep')}
              value={representativeId}
              onChange={setRepresentativeId}
              options={representativeFilterOptions}
              allOptionLabel={t('جميع المناديب', 'All Reps')}
              allOptionValue="all"
              allowClear
              buttonClassName="rounded-md h-8"
            />
          </div>

          <div className="w-[145px] shrink-0">
            <SearchableFilterSelect
              id="imr-filter-movement-type"
              inlinePrefix={t('الحركة', 'Movement')}
              value={movementType}
              onChange={setMovementType}
              options={movementSectionFilterOptions}
              allOptionLabel={t('كافة أقسام الحركة', 'All Movement Sections')}
              allOptionValue="all"
              allowClear
              minPanelWidth={270}
              buttonClassName="rounded-md h-8"
            />
          </div>

          <div className="h-8 flex items-center gap-1 bg-slate-50 dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-1.5 shrink-0">
            <span className="text-[10.5px] font-bold text-slate-500 dark:text-[#8CA3C7] whitespace-nowrap">{t('من', 'From')}</span>
            <input
              type="date"
              aria-label={t('من تاريخ', 'From Date')}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-6 w-[112px] bg-transparent border-0 font-mono text-[11px] focus:outline-none"
            />
          </div>

          <div className="h-8 flex items-center gap-1 bg-slate-50 dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-1.5 shrink-0">
            <span className="text-[10.5px] font-bold text-slate-500 dark:text-[#8CA3C7] whitespace-nowrap">{t('إلى', 'To')}</span>
            <input
              type="date"
              aria-label={t('إلى تاريخ', 'To Date')}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-6 w-[112px] bg-transparent border-0 font-mono text-[11px] focus:outline-none"
            />
          </div>

          <button
            type="button"
            onClick={fetchReport}
            disabled={isLoading}
            className="flex items-center justify-center gap-1 h-8 px-3 rounded-md bg-[#003589] hover:bg-[#011E58] text-white font-bold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{t('تحديث', 'Refresh')}</span>
          </button>

          <button
            type="button"
            onClick={handleResetFilters}
            className="flex items-center justify-center gap-1 h-8 px-2.5 rounded-md border border-slate-300 dark:border-[#2A436E] bg-slate-100 dark:bg-[#132544] hover:bg-slate-200 text-slate-700 dark:text-[#EEF4FC] font-bold whitespace-nowrap shrink-0 cursor-pointer"
            title={t('إعادة ضبط الفلاتر', 'Reset Filters')}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t('إعادة ضبط', 'Reset')}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-800 rounded-lg text-xs font-bold">
          {error}
        </div>
      )}

      {/* Selected Product Header & Breakdown Strips */}
      {report && (
        <>
          {report.product && (
            <div className="awlad-brand-gradient text-white px-2.5 py-2 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-white/15 flex items-center justify-center shrink-0">
                  <Package className="w-3.5 h-3.5 text-white" />
                </div>
                <div>
                  <h4 className="font-black text-xs sm:text-sm">{report.product.name}</h4>
                  <p className="text-slate-300 font-mono text-[10px]">
                    {t('كود:', 'Code:')} {report.product.code} {report.product.barcode ? `| ${t('باركود:', 'Barcode:')} ${report.product.barcode}` : ''} | {t('الوحدة الأساسية:', 'Base Unit:')} {t(report.product.baseUnit)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 tabular-nums">
                <div>
                  <span className="text-slate-400 block text-[10px]">{t('سعر الشراء', 'Purchase Price')}</span>
                  <strong className="font-mono text-xs">{formatLocaleNumber(report.product.purchasePrice)} {currency}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">{t('سعر البيع', 'Selling Price')}</span>
                  <strong className="font-mono text-xs text-emerald-300">{formatLocaleNumber(report.product.sellingPrice)} {currency}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">{t('الرصيد الإجمالي', 'Total Balance')}</span>
                  <strong className="font-mono text-xs text-blue-300">{formatLocaleNumber(report.totals.currentBalance)}</strong>
                </div>
              </div>
            </div>
          )}

          {/* Warehouse & Rep Custody Breakdown */}
          {(report.warehouseBreakdown.length > 0 || report.repCustodyBreakdown.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 text-xs">
              {report.warehouseBreakdown.length > 0 && (
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <h4 className="font-black text-slate-900 mb-1 flex items-center gap-1.5">
                    <WarehouseIcon className="w-3.5 h-3.5 text-blue-800" />
                    <span>{t('توزيع الأرصدة بالمستودعات', 'Warehouse Stock Breakdown')} ({formatLocaleNumber(report.warehouseBreakdown.length)})</span>
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden tabular-nums">
                    {report.warehouseBreakdown.map((wh) => (
                      <div key={wh.warehouseId} className="px-2 py-1.5 bg-slate-50">
                        <div className="font-bold text-slate-800 whitespace-normal break-words">{wh.warehouseName}</div>
                        <div className="font-mono font-black text-blue-950 text-xs">{formatLocaleNumber(wh.quantity)}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{t('تكلفة:', 'Cost:')} {formatLocaleNumber(wh.costValue)} {currency}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.repCustodyBreakdown.length > 0 && (
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <h4 className="font-black text-slate-900 mb-1 flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-[#003589]" />
                    <span>{t('أرصدة عهد سيارات المناديب', 'Rep Vehicle Custody Balances')} ({formatLocaleNumber(report.repCustodyBreakdown.length)})</span>
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-[#DCE6F5] border border-[#DCE6F5] rounded-md overflow-hidden tabular-nums">
                    {report.repCustodyBreakdown.map((rep) => (
                      <div key={rep.representativeId} className="px-2 py-1.5 bg-[#EEF3FA]/70">
                        <div className="font-bold text-slate-900 whitespace-normal break-words">{rep.representativeName}</div>
                        <div className="font-mono font-black text-[#011E58] text-xs">{formatLocaleNumber(rep.quantity)}</div>
                        <div className="text-[10px] text-slate-600 font-mono">{t('تكلفة:', 'Cost:')} {formatLocaleNumber(rep.costValue)} {currency}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Grouped Movement Sections */}
          {visibleSections.length === 0 ? (
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-center text-xs text-slate-500 font-bold">
              {t('لا توجد حركات مسجلة تطابق الفلاتر الحالية.', 'No recorded movements match the current filters.')}
            </div>
          ) : (
            <div className="space-y-2">
              {visibleSections.map((sec) => {
                const rows = report.sections[sec.key] || [];
                const secTotalQty = rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
                const secTotalVal = rows.reduce((s, r) => s + Number(r.totalValue || 0), 0);
                const secTotalProfit = rows.reduce((s, r) => s + Number(r.profitValue || 0), 0);

                const secColumns: UnifiedColumn<ItemMovementRow>[] = [
                  {
                    key: 'date',
                    header: t('التاريخ', 'Date'),
                    sortable: true,
                    sortValue: (r) => r.date,
                    exportValue: (r) => r.date,
                    cellClassName: 'whitespace-nowrap',
                    render: (r) => <span className="font-mono text-slate-600">{r.date}</span>,
                  },
                  {
                    key: 'docNumber',
                    header: t('المستند', 'Document'),
                    sortable: true,
                    sortValue: (r) => r.docNumber,
                    exportValue: (r) => `${r.docNumber} (${formatDocTypeLabel(r.docType)})`,
                    render: (r) => (
                      <div>
                        <div className="font-mono font-bold text-blue-900">{r.docNumber}</div>
                        <div className="text-[10px] text-slate-500">{formatDocTypeLabel(r.docType)}</div>
                      </div>
                    ),
                  },
                ];

                if (sec.key === 'custody_deliveries' || sec.key === 'adjustments') {
                  secColumns.push({
                    key: 'docType',
                    header: t('نوع الحركة', 'Movement Type'),
                    exportValue: (r) => formatDocTypeLabel(r.docType),
                    render: (r) => <span className="font-bold text-slate-700 whitespace-nowrap">{formatDocTypeLabel(r.docType)}</span>,
                  });
                }

                secColumns.push({
                  key: 'productName',
                  header: t('الصنف', 'Item'),
                  sortable: true,
                  sortValue: (r) => r.productName,
                  exportValue: (r) => r.productName,
                  render: (r) => <span className="font-bold text-slate-900">{r.productName}</span>,
                });

                if (sec.key === 'sales' || sec.key === 'sales_returns') {
                  secColumns.push(
                    { key: 'partyName', header: t('العميل', 'Customer'), exportValue: (r) => r.partyName || '-', render: (r) => r.partyName || '-' },
                    { key: 'representativeName', header: t('المندوب', 'Rep'), exportValue: (r) => r.representativeName || '-', render: (r) => r.representativeName || '-' },
                    { key: 'warehouseName', header: t('المستودع', 'Warehouse'), exportValue: (r) => r.warehouseName || '-', render: (r) => r.warehouseName || '-' }
                  );
                } else if (sec.key === 'purchases' || sec.key === 'purchase_returns') {
                  secColumns.push(
                    { key: 'partyName', header: t('المورد', 'Supplier'), exportValue: (r) => r.partyName || '-', render: (r) => r.partyName || '-' },
                    { key: 'warehouseName', header: t('المستودع', 'Warehouse'), exportValue: (r) => r.warehouseName || '-', render: (r) => r.warehouseName || '-' }
                  );
                } else if (sec.key === 'transfers') {
                  secColumns.push({
                    key: 'path',
                    header: `${t('المسار', 'Route')} (${t('من', 'From')} ${arrow} ${t('إلى', 'To')})`,
                    exportValue: (r) => (r.targetWarehouseName ? `${r.warehouseName || ''} -> ${r.targetWarehouseName}` : r.warehouseName || '-'),
                    render: (r) => (r.targetWarehouseName ? `${r.warehouseName || ''} ${arrow} ${r.targetWarehouseName}` : r.warehouseName || '-'),
                  });
                } else if (sec.key === 'custody_sent' || sec.key === 'custody_received') {
                  secColumns.push(
                    { key: 'representativeName', header: t('المندوب', 'Rep'), exportValue: (r) => r.representativeName || '-', render: (r) => r.representativeName || '-' },
                    {
                      key: 'path',
                      header: `${t('المسار', 'Route')} (${t('من', 'From')} ${arrow} ${t('إلى', 'To')})`,
                      exportValue: (r) => (r.targetWarehouseName ? `${r.warehouseName || ''} -> ${r.targetWarehouseName}` : r.warehouseName || '-'),
                      render: (r) => (r.targetWarehouseName ? `${r.warehouseName || ''} ${arrow} ${r.targetWarehouseName}` : r.warehouseName || '-'),
                    }
                  );
                } else if (sec.key === 'custody_deliveries') {
                  secColumns.push(
                    { key: 'representativeName', header: t('المندوب', 'Rep'), exportValue: (r) => r.representativeName || '-', render: (r) => r.representativeName || '-' },
                    { key: 'dest', header: t('العميل / المخزن الوجهة', 'Customer / Target Warehouse'), exportValue: (r) => r.partyName || r.targetWarehouseName || r.warehouseName || '-', render: (r) => r.partyName || r.targetWarehouseName || r.warehouseName || '-' }
                  );
                } else if (sec.key === 'adjustments') {
                  secColumns.push({ key: 'warehouseName', header: t('المستودع', 'Warehouse'), exportValue: (r) => r.warehouseName || '-', render: (r) => r.warehouseName || '-' });
                }

                secColumns.push({
                  key: 'quantity',
                  header: t('الكمية والوحدة', 'Qty & Unit'),
                  align: 'center',
                  sortable: true,
                  sortValue: (r) => r.quantity,
                  exportValue: (r) => `${r.direction === 'in' ? '+' : r.direction === 'out' ? '-' : ''}${r.quantity} ${t(r.unit)}`,
                  render: (r) => (
                    <span className="font-mono font-bold whitespace-nowrap tabular-nums">
                      <span className={r.direction === 'in' ? 'text-emerald-700' : r.direction === 'out' ? 'text-rose-700' : 'text-[#003589]'}>
                        {r.direction === 'in' ? '+' : r.direction === 'out' ? '-' : ''}
                        {formatLocaleNumber(r.quantity)}
                      </span>{' '}
                      <span className="text-[10px] font-sans text-slate-500">{t(r.unit)}</span>
                    </span>
                  ),
                });

                if (sec.key === 'sales' || sec.key === 'sales_returns') {
                  secColumns.push(
                    { key: 'unitPrice', header: t('السعر', 'Price'), align: 'center', sortable: true, sortValue: (r) => r.unitPrice, exportValue: (r) => r.unitPrice, render: (r) => <span className="font-mono tabular-nums">{formatLocaleNumber(r.unitPrice)}</span> },
                    { key: 'costPrice', header: t('التكلفة', 'Cost'), align: 'center', exportValue: (r) => r.costPrice, render: (r) => <span className="font-mono text-slate-500 tabular-nums">{formatLocaleNumber(r.costPrice)}</span> }
                  );
                } else if (sec.key === 'purchases' || sec.key === 'purchase_returns') {
                  secColumns.push({ key: 'unitPrice', header: t('تكلفة الوحدة', 'Unit Cost'), align: 'center', exportValue: (r) => r.unitPrice, render: (r) => <span className="font-mono text-slate-600 tabular-nums">{formatLocaleNumber(r.unitPrice)}</span> });
                } else if (sec.key === 'transfers') {
                  secColumns.push({ key: 'costPrice', header: t('التكلفة', 'Cost'), align: 'center', exportValue: (r) => r.costPrice, render: (r) => <span className="font-mono text-slate-500 tabular-nums">{formatLocaleNumber(r.costPrice)}</span> });
                }

                secColumns.push({
                  key: 'totalValue',
                  header: sec.key === 'custody_sent' || sec.key === 'custody_received' || sec.key === 'custody_deliveries' ? t('القيمة بالتكلفة', 'Value at Cost') : t('الإجمالي', 'Total'),
                  align: 'center',
                  sortable: true,
                  sortValue: (r) => r.totalValue,
                  exportValue: (r) => r.totalValue,
                  render: (r) => (
                    <span className="font-mono font-black text-slate-900 whitespace-nowrap tabular-nums">
                      {formatLocaleNumber(r.totalValue)} {currency}
                    </span>
                  ),
                });

                if (sec.key === 'sales' || sec.key === 'sales_returns') {
                  secColumns.push({
                    key: 'profitValue',
                    header: t('الربح', 'Profit'),
                    align: 'center',
                    sortable: true,
                    sortValue: (r) => r.profitValue,
                    exportValue: (r) => r.profitValue,
                    render: (r) => (
                      <span className={`font-mono font-bold whitespace-nowrap tabular-nums ${r.profitValue > 0 ? 'text-emerald-700' : r.profitValue < 0 ? 'text-red-700' : 'text-slate-400'}`}>
                        {r.profitValue !== 0 ? formatLocaleNumber(r.profitValue) : '-'}
                      </span>
                    ),
                  });
                }

                if (sec.key === 'transfers' || sec.key === 'custody_sent' || sec.key === 'custody_received') {
                  secColumns.push({ key: 'createdBy', header: t('المنفذ', 'Executed By'), exportValue: (r) => r.createdBy || '-', render: (r) => <span className="text-slate-600">{r.createdBy || '-'}</span> });
                }

                if (sec.key === 'adjustments') {
                  secColumns.push({ key: 'notes', header: t('السبب / الملاحظات', 'Reason / Notes'), exportValue: (r) => r.notes || '-', render: (r) => <span className="text-slate-600 max-w-[260px] whitespace-normal break-words block">{r.notes || '-'}</span> });
                }

                secColumns.push({
                  key: 'actions',
                  header: t('التفاصيل', 'Details'),
                  align: 'center',
                  render: (r) => (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRow(r);
                      }}
                      className="p-1 rounded-lg bg-slate-100 hover:bg-blue-100 text-blue-900 cursor-pointer"
                      title={t('عرض تفاصيل المستند', 'View document details')}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  ),
                });

                return (
                  <div key={sec.key} className="space-y-1.5">
                    <div className={`px-2.5 py-1.5 rounded-lg border flex flex-wrap items-center justify-between gap-2 ${sec.bannerCls}`}>
                      <div>
                        <h4 className="font-black text-xs sm:text-sm">{t(sec.title, sec.titleEn)}</h4>
                        <p className="text-[11px] opacity-85">{t(sec.subtitle, sec.subtitleEn)}</p>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums">
                        <span className={`px-2 py-0.5 rounded font-bold ${sec.badgeCls}`}>
                          {formatLocaleNumber(rows.length)} {t('حركة', 'mov.')} | {t('كمية:', 'Qty:')} {formatLocaleNumber(secTotalQty)}
                        </span>
                        <span className="font-black">
                          {t('القيمة:', 'Value:')} {formatLocaleNumber(secTotalVal)} {currency}
                        </span>
                        {sec.key === 'sales' && (
                          <span className="font-black text-emerald-300">
                            {t('الربح:', 'Profit:')} {formatLocaleNumber(secTotalProfit)} {currency}
                          </span>
                        )}
                      </div>
                    </div>

                    <UnifiedDataTable<ItemMovementRow>
                      compact
                      searchable={false}
                      data={rows}
                      rowKey={(r) => r.id}
                      onRowClick={(r) => setSelectedRow(r)}
                      defaultPageSize={25}
                      exportFilename={`Item_Movement_${sec.key}`}
                      pdfTitle={t(sec.title, sec.titleEn)}
                      columns={secColumns}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Fixed Bottom Summary Bar */}
          <div className="sticky bottom-0 z-20 bg-[#001A49] text-white px-2.5 py-1.5 rounded-lg border border-[#002160] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs tabular-nums">
            <div>
              <span className="text-slate-300 text-[10px] block">{t('إجمالي المبيعات', 'Total Sales')} ({t('كمية:', 'Qty:')} {formatLocaleNumber(report.totals.totalSalesQty)})</span>
              <strong className="text-xs font-mono font-black text-[#DCE6F5]">
                {formatLocaleNumber(report.totals.totalSalesValue)} {currency}
              </strong>
            </div>
            <div>
              <span className="text-slate-300 text-[10px] block">{t('إجمالي المشتريات', 'Total Purchases')} ({t('كمية:', 'Qty:')} {formatLocaleNumber(report.totals.totalPurchaseQty)})</span>
              <strong className="text-xs font-mono font-black text-[#DCE6F5]">
                {formatLocaleNumber(report.totals.totalPurchaseValue)} {currency}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-emerald-400" /> {t('الربح (على التكلفة)', 'Profit (on Cost)')}
              </span>
              <strong className={`text-xs font-mono font-black ${report.totals.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatLocaleNumber(report.totals.totalProfit)} {currency}
              </strong>
              <span className="block text-[10px] text-slate-400 font-mono">
                {t('تكلفة المباع:', 'COGS:')} {formatLocaleNumber(report.totals.totalCostOfGoodsSold)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] flex items-center gap-1">
                <ArrowDownLeft className="w-3 h-3 text-emerald-400" /> {t('إجمالي الوارد (+)', 'Total In (+)')}
              </span>
              <strong className="text-xs font-mono font-black text-emerald-300">
                +{formatLocaleNumber(report.totals.totalQtyIn)}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] flex items-center gap-1">
                <ArrowUpRight className="w-3 h-3 text-rose-400" /> {t('إجمالي المنصرف (-)', 'Total Out (-)')}
              </span>
              <strong className="text-xs font-mono font-black text-rose-300">
                -{formatLocaleNumber(report.totals.totalQtyOut)}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] block">{t('الرصيد الحالي / التقييم', 'Current Balance / Valuation')}</span>
              <strong className="text-xs font-mono font-black text-white">
                {formatLocaleNumber(report.totals.currentBalance)} ({formatLocaleNumber(report.totals.inventoryValuation)} {currency})
              </strong>
            </div>
          </div>
        </>
      )}

      {/* Source Document Details Modal */}
      <Modal
        isOpen={Boolean(selectedRow)}
        onClose={() => setSelectedRow(null)}
        title={selectedRow ? `${t('تفاصيل المستند:', 'Document Details:')} ${selectedRow.docNumber}` : ''}
        subtitle={selectedRow ? `${formatDocTypeLabel(selectedRow.docType)} · ${selectedRow.date}` : ''}
        maxWidth="2xl"
      >
        {selectedRow && (
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200 tabular-nums">
              <div>
                <span className="text-slate-500 block">{t('الصنف:', 'Item:')}</span>
                <strong className="text-slate-900">{selectedRow.productName}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">{t('الكمية والوحدة:', 'Qty & Unit:')}</span>
                <strong className="font-mono text-blue-950">{formatLocaleNumber(selectedRow.quantity)} {t(selectedRow.unit)}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">{t('القيمة / التكلفة:', 'Value / Cost:')}</span>
                <strong className="font-mono">{formatLocaleNumber(selectedRow.totalValue)} / {formatLocaleNumber(selectedRow.costPrice)} {currency}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">{t('المستودع:', 'Warehouse:')}</span>
                <strong>{selectedRow.targetWarehouseName ? `${selectedRow.warehouseName || ''} ${arrow} ${selectedRow.targetWarehouseName}` : selectedRow.warehouseName || '-'}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">{t('الطرف / المندوب:', 'Party / Rep:')}</span>
                <strong>{selectedRow.partyName || selectedRow.representativeName || '-'}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">{t('بواسطة:', 'Created By:')}</span>
                <strong>{selectedRow.createdBy || '-'}</strong>
              </div>
            </div>

            {selectedRow.notes && (
              <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-950">
                <strong>{t('ملاحظات:', 'Notes:')}</strong> {t(selectedRow.notes)}
              </div>
            )}

            {sourceDocDetails?.kind === 'invoice' && (
              <UnifiedDataTable
                compact
                searchable={false}
                paginated={false}
                title={`${t('بنود الفاتورة', 'Invoice Items')} (${sourceDocDetails.data.invoiceNumber}) — ${t('الإجمالي:', 'Total:')} ${formatLocaleNumber(sourceDocDetails.data.grandTotal)} ${currency}`}
                data={sourceDocDetails.data.items.map((it, idx) => ({ ...it, _idx: idx }))}
                rowKey={(it) => `${it.productId}-${it._idx}`}
                columns={[
                  { key: 'productName', header: t('الصنف', 'Item'), render: (it) => <span className="font-bold">{it.productName}</span> },
                  { key: 'unit', header: t('الوحدة', 'Unit'), align: 'center', render: (it) => t(it.unit) },
                  { key: 'quantity', header: t('الكمية', 'Quantity'), align: 'center', render: (it) => <span className="font-mono tabular-nums">{formatLocaleNumber(it.quantity)}</span> },
                  { key: 'unitPrice', header: t('السعر', 'Price'), align: 'center', render: (it) => <span className="font-mono tabular-nums">{formatLocaleNumber(it.unitPrice)}</span> },
                  { key: 'total', header: t('الإجمالي', 'Total'), align: 'center', render: (it) => <span className="font-mono font-bold text-blue-900 tabular-nums">{formatLocaleNumber(it.total)}</span> },
                ]}
              />
            )}

            {sourceDocDetails?.kind === 'return' && (
              <UnifiedDataTable
                compact
                searchable={false}
                paginated={false}
                title={`${t('بنود المرتجع', 'Return Items')} (${sourceDocDetails.data.returnNumber}) — ${t('الإجمالي:', 'Total:')} ${formatLocaleNumber(sourceDocDetails.data.grandTotal)} ${currency}`}
                data={sourceDocDetails.data.items.map((it, idx) => ({ ...it, _idx: idx }))}
                rowKey={(it) => `${it.productId}-${it._idx}`}
                columns={[
                  { key: 'productName', header: t('الصنف', 'Item'), render: (it) => <span className="font-bold">{it.productName}</span> },
                  { key: 'unit', header: t('الوحدة', 'Unit'), align: 'center', render: (it) => t(it.unit) },
                  { key: 'quantity', header: t('الكمية', 'Quantity'), align: 'center', render: (it) => <span className="font-mono tabular-nums">{formatLocaleNumber(it.quantity)}</span> },
                  { key: 'total', header: t('الإجمالي', 'Total'), align: 'center', render: (it) => <span className="font-mono font-bold tabular-nums">{formatLocaleNumber(it.total)}</span> },
                ]}
              />
            )}

            {sourceDocDetails?.kind === 'rep_transfer' && (
              <UnifiedDataTable
                compact
                searchable={false}
                paginated={false}
                title={`${t('أصناف إذن عهدة المندوب', 'Rep Custody Note Items')} (${sourceDocDetails.data.requestNumber}) — ${t('الحالة:', 'Status:')} ${t(sourceDocDetails.data.status)}`}
                data={sourceDocDetails.data.items.map((it, idx) => ({ ...it, _idx: idx }))}
                rowKey={(it) => `${it.productId}-${it._idx}`}
                columns={[
                  { key: 'productName', header: t('الصنف', 'Item'), render: (it) => <span className="font-bold">{it.productName}</span> },
                  { key: 'unit', header: t('الوحدة', 'Unit'), align: 'center', render: (it) => t(it.unit) },
                  { key: 'requestedQty', header: t('الكمية المطلوبة', 'Requested Qty'), align: 'center', render: (it) => <span className="font-mono tabular-nums">{formatLocaleNumber(it.requestedQty)}</span> },
                  { key: 'executedQty', header: t('المصروفة', 'Dispatched'), align: 'center', render: (it) => <span className="font-mono font-bold tabular-nums">{formatLocaleNumber(it.executedQty ?? it.approvedQty ?? it.requestedQty)}</span> },
                ]}
              />
            )}

            {sourceDocDetails?.kind === 'stock_transfer' && (
              <UnifiedDataTable
                compact
                searchable={false}
                paginated={false}
                title={`${t('أصناف التحويل المخزني', 'Stock Transfer Items')} (${sourceDocDetails.data.transferNumber})`}
                data={sourceDocDetails.data.items.map((it, idx) => ({ ...it, _idx: idx }))}
                rowKey={(it) => `${it.productId}-${it._idx}`}
                columns={[
                  { key: 'productName', header: t('الصنف', 'Item'), render: (it) => <span className="font-bold">{it.productName}</span> },
                  { key: 'unit', header: t('الوحدة', 'Unit'), align: 'center', render: (it) => t(it.unit) },
                  { key: 'qty', header: t('الكمية', 'Quantity'), align: 'center', render: (it) => <span className="font-mono font-bold tabular-nums">{formatLocaleNumber(it.executedQty ?? it.requestedQty)}</span> },
                ]}
              />
            )}

            {sourceDocDetails?.kind === 'rep_custody' && (
              <div className="border border-[#DCE6F5] rounded-lg overflow-hidden bg-[#EEF3FA] p-2.5 space-y-1.5">
                <div className="font-bold text-[#011E58]">
                  {t('مستند عهدة المندوب', 'Rep Custody Document')} ({sourceDocDetails.data.operationNumber}) — {t(sourceDocDetails.data.operationType)}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                  <div>{t('المندوب:', 'Rep:')} <strong>{sourceDocDetails.data.representativeName}</strong></div>
                  <div>{t('الكمية:', 'Qty:')} <strong className="font-mono">{formatLocaleNumber(sourceDocDetails.data.quantity)} {t(sourceDocDetails.data.unit)}</strong></div>
                  <div>{t('الأساس:', 'Base:')} <strong className="font-mono">{formatLocaleNumber(sourceDocDetails.data.baseQuantity)}</strong></div>
                  {sourceDocDetails.data.customerName && (
                    <div>{t('العميل:', 'Customer:')} <strong>{sourceDocDetails.data.customerName}</strong></div>
                  )}
                  {sourceDocDetails.data.targetWarehouseName && (
                    <div>{t('المخزن الوجهة:', 'Target Warehouse:')} <strong>{sourceDocDetails.data.targetWarehouseName}</strong></div>
                  )}
                  <div>{t('الحالة:', 'Status:')} <strong>{t(sourceDocDetails.data.status)}</strong></div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-1.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handlePrintSelectedSourceDoc}
                className="flex items-center gap-1 h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#011E58] text-white font-bold cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{t('طباعة المستند', 'Print Document')}</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedRow(null)}
                className="h-8 px-2.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
              >
                {t('إغلاق', 'Close')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <PrintDocumentModal
        isOpen={isPrintOpen}
        onClose={() => setIsPrintOpen(false)}
        data={printData}
      />
    </div>
  );
};

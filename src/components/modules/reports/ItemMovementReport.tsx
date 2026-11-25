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

const SECTION_META: Array<{
  key: SectionKey;
  title: string;
  subtitle: string;
  bannerCls: string;
  badgeCls: string;
}> = [
  {
    key: 'sales',
    title: '1. فواتير المبيعات المعتمدة',
    subtitle: 'المبيعات الفعلية واحتساب الربحية بناءً على التكلفة',
    bannerCls: 'bg-[#011E58] text-white border-[#002160]',
    badgeCls: 'bg-[#003589] text-[#DCE6F5]',
  },
  {
    key: 'purchases',
    title: '2. فواتير المشتريات والتوريدات',
    subtitle: 'الكميات المضافة للمخزون من الموردين وتكلفة الشراء',
    bannerCls: 'bg-[#002160] text-white border-[#011E58]',
    badgeCls: 'bg-[#003589] text-[#DCE6F5]',
  },
  {
    key: 'sales_returns',
    title: '3. مرتجعات المبيعات',
    subtitle: 'الكميات المرتجعة من العملاء وإضافتها للمخزن',
    bannerCls: 'bg-amber-800 text-white border-amber-700',
    badgeCls: 'bg-amber-700 text-amber-100',
  },
  {
    key: 'purchase_returns',
    title: '4. مرتجعات المشتريات',
    subtitle: 'الكميات المرتجعة للموردين وخصمها من المخزن',
    bannerCls: 'bg-amber-900 text-white border-amber-800',
    badgeCls: 'bg-amber-800 text-amber-100',
  },
  {
    key: 'transfers',
    title: '5. التحويلات المخزنية بين المستودعات',
    subtitle: 'حركات نقل داخلي مستبعدة من إجمالي المبيعات',
    bannerCls: 'bg-[#003589] text-white border-[#002160]',
    badgeCls: 'bg-[#011E58] text-[#DCE6F5]',
  },
  {
    key: 'custody_sent',
    title: '6. صرف عهدة البضاعة من المخزن للمندوب',
    subtitle: 'أذونات الصرف الصادرة من المستودع الرئيسي للمناديب',
    bannerCls: 'bg-[#0049B0] text-white border-[#003589]',
    badgeCls: 'bg-[#011E58] text-[#DCE6F5]',
  },
  {
    key: 'custody_received',
    title: '7. استلام العهدة في سيارات المناديب',
    subtitle: 'الأذونات المؤكد استلامها فعلياً في عهدة سيارة المندوب',
    bannerCls: 'bg-[#011E58] text-white border-[#003589]',
    badgeCls: 'bg-[#0049B0] text-white',
  },
  {
    key: 'custody_deliveries',
    title: '8. تسليمات وإرجاعات عهدة المناديب',
    subtitle: 'التسليم الجزئي للعملاء أو الإرجاع من السيارة للمخزن',
    bannerCls: 'bg-slate-800 text-white border-slate-700',
    badgeCls: 'bg-slate-700 text-slate-100',
  },
  {
    key: 'adjustments',
    title: '9. تسويات الجرد والتالف والعجز',
    subtitle: 'الرصيد الافتتاحي، تسويات الجرد، التوالف، وتسويات العهد',
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
          subtitle: `${p.code}${p.barcode ? ` • ${p.barcode}` : ''} • الرصيد: ${stockQty} ${p.baseUnit}`,
          badge: p.code,
          searchText: `${p.code} ${p.barcode || ''} ${p.category || ''}`,
        };
      }),
    [products, warehouseId]
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
        label: sec.title,
        subtitle: sec.subtitle,
      })),
    []
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
      setError(res.error || 'تعذر تحميل تقرير حركة الصنف');
    } else {
      setReport(res.report);
    }
  }, [productId, warehouseId, representativeId, movementType, dateFrom, dateTo, search, getItemMovementReport]);

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
      'القسم / نوع الحركة',
      'التاريخ',
      'رقم المستند',
      'الصنف',
      'المستودع / المسار',
      'الطرف / المندوب',
      'الوحدة',
      'الكمية',
      'سعر الوحدة',
      'سعر التكلفة',
      'الإجمالي',
      'الربح (على التكلفة)',
      'ملاحظات',
    ];
    const rows: Array<Array<string | number>> = [];
    if (!report) return { headers, rows };

    visibleSections.forEach((sec) => {
      const list = report.sections[sec.key] || [];
      rows.push([`=== ${sec.title} (${list.length}) ===`, '', '', '', '', '', '', '', '', '', '', '', '']);
      list.forEach((r) => {
        rows.push([
          r.docType,
          r.date,
          r.docNumber,
          r.productName,
          r.targetWarehouseName ? `${r.warehouseName || ''} ⬅ ${r.targetWarehouseName}` : r.warehouseName || '-',
          r.partyName || r.representativeName || '-',
          r.unit,
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
    const label = report?.product ? report.product.name : 'كل_الأصناف';
    exportToExcel(`تقرير_حركة_الصنف_${label}_${new Date().toISOString().split('T')[0]}`, headers, rows);
  };

  const handleExportPdf = () => {
    if (!report) return;
    const { headers, rows } = buildGroupedExportRows();
    exportTableToPdf(
      `تقرير حركة الصنف المفصل${report.product ? ` — ${report.product.name}` : ''}`,
      headers,
      rows,
      {
        companyName: settings.companyName,
        companySubtitle: settings.companySubtitle,
        dateRangeText: `${dateFrom || 'البداية'} إلى ${dateTo || 'اليوم'}`,
        summaryPairs: [
          { label: 'إجمالي المبيعات', value: `${report.totals.totalSalesValue.toLocaleString()} ${settings.currency}` },
          { label: 'إجمالي المشتريات', value: `${report.totals.totalPurchaseValue.toLocaleString()} ${settings.currency}` },
          { label: 'الربح المبني على التكلفة', value: `${report.totals.totalProfit.toLocaleString()} ${settings.currency}`, highlight: true },
          { label: 'الرصيد الحالي وتقييم المخزون', value: `${report.totals.currentBalance} (${report.totals.inventoryValuation.toLocaleString()} ${settings.currency})` },
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
        name: `--- ${sec.title} ---`,
        unit: '-',
        quantity: list.length,
        price: 0,
        total: list.reduce((s, r) => s + Number(r.totalValue || 0), 0),
      });
      list.forEach((r) => {
        items.push({
          name: `${r.date} | ${r.docNumber} | ${r.productName}${r.partyName ? ` (${r.partyName})` : ''}`,
          unit: r.unit,
          quantity: r.quantity,
          price: r.unitPrice,
          discount: r.profitValue,
          total: r.totalValue,
        });
      });
    });

    setPrintData({
      title: `تقرير حركة الصنف المفصل${report.product ? ` — ${report.product.name}` : ''}`,
      docNumber: report.product?.code || 'ALL-ITEMS',
      docType: 'كشف حساب',
      date: `${dateFrom || 'بداية النشاط'} إلى ${dateTo || 'اليوم'}`,
      partyName: report.product ? `${report.product.name} (${report.product.code})` : 'جميع الأصناف',
      warehouseName: warehouseId === 'all' ? 'جميع المستودعات' : warehouses.find((w) => w.id === warehouseId)?.name,
      representativeName: representativeId === 'all' ? 'جميع المناديب' : representatives.find((r) => r.id === representativeId)?.name,
      tableHeaders: ['م', 'القسم / المستند والصنف', 'الوحدة', 'الكمية', 'السعر', 'الربح', 'الإجمالي'],
      items,
      grandTotal: report.totals.totalSalesValue,
      paidAmount: report.totals.totalPurchaseValue,
      remainingAmount: report.totals.totalProfit,
      notes: `إجمالي الوارد: ${report.totals.totalQtyIn} | إجمالي المنصرف: ${report.totals.totalQtyOut} | الرصيد الحالي: ${report.totals.currentBalance} | تقييم المخزون بالتكلفة: ${report.totals.inventoryValuation.toLocaleString()} ${settings.currency}`,
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
    const repReq = repItemTransfers.find((t) => t.id === selectedRow.docId);
    if (repReq) return { kind: 'rep_transfer' as const, data: repReq };
    const stReq = stockTransferRequests.find((t) => t.id === selectedRow.docId);
    if (stReq) return { kind: 'stock_transfer' as const, data: stReq };
    const custodyOp = repCustodyOperations.find((op) => op.id === selectedRow.docId);
    if (custodyOp) return { kind: 'rep_custody' as const, data: custodyOp };
    return null;
  }, [selectedRow, invoices, invoiceReturns, repItemTransfers, stockTransferRequests, repCustodyOperations]);

  const handlePrintSelectedSourceDoc = () => {
    if (!selectedRow) return;
    if (sourceDocDetails?.kind === 'invoice') {
      const inv = sourceDocDetails.data;
      setPrintData({
        title: inv.type === 'purchase' ? 'فاتورة مشتريات' : inv.type === 'quote' ? 'عرض سعر' : 'فاتورة مبيعات',
        docNumber: inv.invoiceNumber,
        docType: inv.type === 'purchase' ? 'فاتورة مشتريات' : inv.type === 'quote' ? 'عرض سعر' : 'فاتورة مبيعات',
        date: inv.date,
        partyName: inv.supplierName || inv.customerName || '-',
        warehouseName: inv.warehouseName,
        representativeName: inv.representativeName,
        tableHeaders: ['م', 'الصنف', 'الوحدة', 'الكمية', 'السعر', 'الخصم', 'الإجمالي'],
        items: (inv.items || []).map((it) => ({
          name: it.productName,
          unit: it.unit,
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
        title: ret.type === 'purchase_return' ? 'إشعار مرتجع مشتريات' : 'إشعار مرتجع مبيعات',
        docNumber: ret.returnNumber,
        docType: ret.type === 'purchase_return' ? 'مرتجع مشتريات' : 'مرتجع مبيعات',
        date: ret.date,
        partyName: ret.partyName,
        warehouseName: ret.warehouseName,
        tableHeaders: ['م', 'الصنف', 'الوحدة', 'الكمية', 'السعر', 'الخصم', 'الإجمالي'],
        items: (ret.items || []).map((it) => ({
          name: it.productName,
          unit: it.unit,
          quantity: it.quantity,
          price: it.unitPrice,
          total: it.total,
        })),
        grandTotal: ret.grandTotal,
        notes: ret.reason,
      });
    } else if (sourceDocDetails?.kind === 'rep_transfer') {
      const tr = sourceDocDetails.data;
      setPrintData({
        title: 'إذن صرف / تحويل عهدة مندوب',
        docNumber: tr.requestNumber,
        docType: tr.status === 'received' ? 'إيصال استلام' : 'سند صرف',
        date: tr.date,
        partyName: tr.representativeName,
        warehouseName: `${tr.sourceWarehouseName} ⬅ ${tr.targetWarehouseName}`,
        representativeName: tr.representativeName,
        tableHeaders: ['م', 'الصنف', 'الوحدة', 'الكمية المنفذة', 'السعر', 'الخصم', 'الإجمالي'],
        items: (tr.items || []).map((it) => ({
          name: it.productName,
          unit: it.unit,
          quantity: it.executedQty ?? it.approvedQty ?? it.requestedQty,
          price: 0,
          total: 0,
        })),
        grandTotal: selectedRow.totalValue,
        notes: tr.notes,
      });
    } else if (sourceDocDetails?.kind === 'stock_transfer') {
      const st = sourceDocDetails.data;
      setPrintData({
        title: 'مستند تحويل مخزني',
        docNumber: st.transferNumber,
        docType: 'سند صرف',
        date: st.date,
        warehouseName: `${st.sourceWarehouseName} ⬅ ${st.targetWarehouseName}`,
        tableHeaders: ['م', 'الصنف', 'الوحدة', 'الكمية', 'السعر', 'الخصم', 'الإجمالي'],
        items: (st.items || []).map((it) => ({
          name: it.productName,
          unit: it.unit,
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
        title: `تفاصيل مستند حركة الصنف (${selectedRow.docType})`,
        docNumber: selectedRow.docNumber,
        docType: fallbackDocType,
        date: selectedRow.date,
        partyName: selectedRow.partyName || selectedRow.representativeName || '-',
        warehouseName: selectedRow.targetWarehouseName
          ? `${selectedRow.warehouseName || ''} ⬅ ${selectedRow.targetWarehouseName}`
          : selectedRow.warehouseName,
        representativeName: selectedRow.representativeName,
        tableHeaders: ['م', 'الصنف', 'الوحدة', 'الكمية', 'السعر', 'الخصم', 'الإجمالي'],
        items: [
          {
            name: selectedRow.productName,
            unit: selectedRow.unit,
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
          <h3 className="text-sm font-black text-slate-900">تقرير حركة الصنف المفصل والشامل</h3>
          <p className="text-[11px] text-slate-500">
            متابعة المبيعات والمشتريات والمرتجعات والتحويلات وعهد المناديب والتسويات مع احتساب الأرباح على التكلفة وتقييم المخزون
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
            <span>طباعة التقرير</span>
          </button>
        </div>
      </div>

      {/* Multi-Filter Toolbar */}
      <div className="bg-white p-2 rounded-lg border border-slate-200 space-y-1.5 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-end">
          <div>
            <SearchableFilterSelect
              id="imr-filter-product"
              label="الصنف (بحث بالاسم / الكود / الباركود)"
              value={productId}
              onChange={setProductId}
              options={productFilterOptions}
              allOptionLabel="جميع الأصناف"
              allOptionValue="all"
              searchPlaceholder="ابحث باسم الصنف أو الكود أو الباركود..."
              allowClear
              minPanelWidth={280}
              buttonClassName="rounded-md h-8"
            />
          </div>
          <div>
            <SearchableFilterSelect
              id="imr-filter-warehouse"
              label="المستودع"
              value={warehouseId}
              onChange={setWarehouseId}
              options={warehouseFilterOptions}
              allOptionLabel="جميع المستودعات"
              allOptionValue="all"
              allowClear
              buttonClassName="rounded-md h-8"
            />
          </div>
          <div>
            <SearchableFilterSelect
              id="imr-filter-rep"
              label="المندوب"
              value={representativeId}
              onChange={setRepresentativeId}
              options={representativeFilterOptions}
              allOptionLabel="جميع المناديب"
              allOptionValue="all"
              allowClear
              buttonClassName="rounded-md h-8"
            />
          </div>
          <div>
            <SearchableFilterSelect
              id="imr-filter-movement-type"
              label="نوع الحركة / القسم"
              value={movementType}
              onChange={setMovementType}
              options={movementSectionFilterOptions}
              allOptionLabel="كافة أقسام الحركة"
              allOptionValue="all"
              allowClear
              minPanelWidth={270}
              buttonClassName="rounded-md h-8"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 items-end">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-0.5">من تاريخ:</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full h-8 px-2.5 py-1 rounded-md border border-slate-300 font-mono text-xs bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-0.5">إلى تاريخ:</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full h-8 px-2.5 py-1 rounded-md border border-slate-300 font-mono text-xs bg-slate-50"
            />
          </div>
          <div className="lg:col-span-2 relative">
            <label className="block text-[11px] font-bold text-slate-600 mb-0.5">بحث في المستندات أو الأطراف:</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="رقم فاتورة، عميل، مورد، أو ملاحظات..."
                className="w-full h-8 pr-8 pl-2.5 py-1 rounded-md border border-slate-300 text-xs bg-slate-50 focus:bg-white"
              />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={fetchReport}
              disabled={isLoading}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 px-3 rounded-md bg-[#003589] hover:bg-[#011E58] text-white font-bold cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>تحديث</span>
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              className="flex items-center justify-center gap-1 h-8 px-2.5 rounded-md border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
              title="إعادة ضبط الفلاتر"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
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
                    كود: {report.product.code} {report.product.barcode ? `| باركود: ${report.product.barcode}` : ''} | الوحدة الأساسية: {report.product.baseUnit}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 tabular-nums">
                <div>
                  <span className="text-slate-400 block text-[10px]">سعر الشراء</span>
                  <strong className="font-mono text-xs">{report.product.purchasePrice.toLocaleString()} {settings.currency}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">سعر البيع</span>
                  <strong className="font-mono text-xs text-emerald-300">{report.product.sellingPrice.toLocaleString()} {settings.currency}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">الرصيد الإجمالي</span>
                  <strong className="font-mono text-xs text-blue-300">{report.totals.currentBalance}</strong>
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
                    <span>توزيع الأرصدة بالمستودعات ({report.warehouseBreakdown.length})</span>
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden tabular-nums">
                    {report.warehouseBreakdown.map((wh) => (
                      <div key={wh.warehouseId} className="px-2 py-1.5 bg-slate-50">
                        <div className="font-bold text-slate-800 truncate">{wh.warehouseName}</div>
                        <div className="font-mono font-black text-blue-950 text-xs">{wh.quantity}</div>
                        <div className="text-[10px] text-slate-500 font-mono">تكلفة: {wh.costValue.toLocaleString()} {settings.currency}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.repCustodyBreakdown.length > 0 && (
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <h4 className="font-black text-slate-900 mb-1 flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-[#003589]" />
                    <span>أرصدة عهد سيارات المناديب ({report.repCustodyBreakdown.length})</span>
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-[#DCE6F5] border border-[#DCE6F5] rounded-md overflow-hidden tabular-nums">
                    {report.repCustodyBreakdown.map((rep) => (
                      <div key={rep.representativeId} className="px-2 py-1.5 bg-[#EEF3FA]/70">
                        <div className="font-bold text-slate-900 truncate">{rep.representativeName}</div>
                        <div className="font-mono font-black text-[#011E58] text-xs">{rep.quantity}</div>
                        <div className="text-[10px] text-slate-600 font-mono">تكلفة: {rep.costValue.toLocaleString()} {settings.currency}</div>
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
              لا توجد حركات مسجلة تطابق الفلاتر الحالية.
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
                    header: 'التاريخ',
                    sortable: true,
                    sortValue: (r) => r.date,
                    exportValue: (r) => r.date,
                    cellClassName: 'whitespace-nowrap',
                    render: (r) => <span className="font-mono text-slate-600">{r.date}</span>,
                  },
                  {
                    key: 'docNumber',
                    header: 'المستند',
                    sortable: true,
                    sortValue: (r) => r.docNumber,
                    exportValue: (r) => `${r.docNumber} (${r.docType})`,
                    render: (r) => (
                      <div>
                        <div className="font-mono font-bold text-blue-900">{r.docNumber}</div>
                        <div className="text-[10px] text-slate-500">{r.docType}</div>
                      </div>
                    ),
                  },
                ];

                if (sec.key === 'custody_deliveries' || sec.key === 'adjustments') {
                  secColumns.push({
                    key: 'docType',
                    header: 'نوع الحركة',
                    exportValue: (r) => r.docType,
                    render: (r) => <span className="font-bold text-slate-700 whitespace-nowrap">{r.docType}</span>,
                  });
                }

                secColumns.push({
                  key: 'productName',
                  header: 'الصنف',
                  sortable: true,
                  sortValue: (r) => r.productName,
                  exportValue: (r) => r.productName,
                  render: (r) => <span className="font-bold text-slate-900">{r.productName}</span>,
                });

                if (sec.key === 'sales' || sec.key === 'sales_returns') {
                  secColumns.push(
                    { key: 'partyName', header: 'العميل', exportValue: (r) => r.partyName || '-', render: (r) => r.partyName || '-' },
                    { key: 'representativeName', header: 'المندوب', exportValue: (r) => r.representativeName || '-', render: (r) => r.representativeName || '-' },
                    { key: 'warehouseName', header: 'المستودع', exportValue: (r) => r.warehouseName || '-', render: (r) => r.warehouseName || '-' }
                  );
                } else if (sec.key === 'purchases' || sec.key === 'purchase_returns') {
                  secColumns.push(
                    { key: 'partyName', header: 'المورد', exportValue: (r) => r.partyName || '-', render: (r) => r.partyName || '-' },
                    { key: 'warehouseName', header: 'المستودع', exportValue: (r) => r.warehouseName || '-', render: (r) => r.warehouseName || '-' }
                  );
                } else if (sec.key === 'transfers') {
                  secColumns.push({
                    key: 'path',
                    header: 'المسار (من ⬅ إلى)',
                    exportValue: (r) => (r.targetWarehouseName ? `${r.warehouseName || ''} -> ${r.targetWarehouseName}` : r.warehouseName || '-'),
                    render: (r) => (r.targetWarehouseName ? `${r.warehouseName || ''} ⬅ ${r.targetWarehouseName}` : r.warehouseName || '-'),
                  });
                } else if (sec.key === 'custody_sent' || sec.key === 'custody_received') {
                  secColumns.push(
                    { key: 'representativeName', header: 'المندوب', exportValue: (r) => r.representativeName || '-', render: (r) => r.representativeName || '-' },
                    {
                      key: 'path',
                      header: 'المسار (من ⬅ إلى)',
                      exportValue: (r) => (r.targetWarehouseName ? `${r.warehouseName || ''} -> ${r.targetWarehouseName}` : r.warehouseName || '-'),
                      render: (r) => (r.targetWarehouseName ? `${r.warehouseName || ''} ⬅ ${r.targetWarehouseName}` : r.warehouseName || '-'),
                    }
                  );
                } else if (sec.key === 'custody_deliveries') {
                  secColumns.push(
                    { key: 'representativeName', header: 'المندوب', exportValue: (r) => r.representativeName || '-', render: (r) => r.representativeName || '-' },
                    { key: 'dest', header: 'العميل / المخزن الوجهة', exportValue: (r) => r.partyName || r.targetWarehouseName || r.warehouseName || '-', render: (r) => r.partyName || r.targetWarehouseName || r.warehouseName || '-' }
                  );
                } else if (sec.key === 'adjustments') {
                  secColumns.push({ key: 'warehouseName', header: 'المستودع', exportValue: (r) => r.warehouseName || '-', render: (r) => r.warehouseName || '-' });
                }

                secColumns.push({
                  key: 'quantity',
                  header: 'الكمية والوحدة',
                  align: 'center',
                  sortable: true,
                  sortValue: (r) => r.quantity,
                  exportValue: (r) => `${r.direction === 'in' ? '+' : r.direction === 'out' ? '-' : ''}${r.quantity} ${r.unit}`,
                  render: (r) => (
                    <span className="font-mono font-bold whitespace-nowrap tabular-nums">
                      <span className={r.direction === 'in' ? 'text-emerald-700' : r.direction === 'out' ? 'text-rose-700' : 'text-[#003589]'}>
                        {r.direction === 'in' ? '+' : r.direction === 'out' ? '-' : ''}
                        {r.quantity}
                      </span>{' '}
                      <span className="text-[10px] font-sans text-slate-500">{r.unit}</span>
                    </span>
                  ),
                });

                if (sec.key === 'sales' || sec.key === 'sales_returns') {
                  secColumns.push(
                    { key: 'unitPrice', header: 'السعر', align: 'center', sortable: true, sortValue: (r) => r.unitPrice, exportValue: (r) => r.unitPrice, render: (r) => <span className="font-mono tabular-nums">{r.unitPrice.toLocaleString()}</span> },
                    { key: 'costPrice', header: 'التكلفة', align: 'center', exportValue: (r) => r.costPrice, render: (r) => <span className="font-mono text-slate-500 tabular-nums">{r.costPrice.toLocaleString()}</span> }
                  );
                } else if (sec.key === 'purchases' || sec.key === 'purchase_returns') {
                  secColumns.push({ key: 'unitPrice', header: 'تكلفة الوحدة', align: 'center', exportValue: (r) => r.unitPrice, render: (r) => <span className="font-mono text-slate-600 tabular-nums">{r.unitPrice.toLocaleString()}</span> });
                } else if (sec.key === 'transfers') {
                  secColumns.push({ key: 'costPrice', header: 'التكلفة', align: 'center', exportValue: (r) => r.costPrice, render: (r) => <span className="font-mono text-slate-500 tabular-nums">{r.costPrice.toLocaleString()}</span> });
                }

                secColumns.push({
                  key: 'totalValue',
                  header: sec.key === 'custody_sent' || sec.key === 'custody_received' || sec.key === 'custody_deliveries' ? 'القيمة بالتكلفة' : 'الإجمالي',
                  align: 'center',
                  sortable: true,
                  sortValue: (r) => r.totalValue,
                  exportValue: (r) => r.totalValue,
                  render: (r) => (
                    <span className="font-mono font-black text-slate-900 whitespace-nowrap tabular-nums">
                      {r.totalValue.toLocaleString()} {settings.currency}
                    </span>
                  ),
                });

                if (sec.key === 'sales' || sec.key === 'sales_returns') {
                  secColumns.push({
                    key: 'profitValue',
                    header: 'الربح',
                    align: 'center',
                    sortable: true,
                    sortValue: (r) => r.profitValue,
                    exportValue: (r) => r.profitValue,
                    render: (r) => (
                      <span className={`font-mono font-bold whitespace-nowrap tabular-nums ${r.profitValue > 0 ? 'text-emerald-700' : r.profitValue < 0 ? 'text-red-700' : 'text-slate-400'}`}>
                        {r.profitValue !== 0 ? r.profitValue.toLocaleString() : '-'}
                      </span>
                    ),
                  });
                }

                if (sec.key === 'transfers' || sec.key === 'custody_sent' || sec.key === 'custody_received') {
                  secColumns.push({ key: 'createdBy', header: 'المنفذ', exportValue: (r) => r.createdBy || '-', render: (r) => <span className="text-slate-600">{r.createdBy || '-'}</span> });
                }

                if (sec.key === 'adjustments') {
                  secColumns.push({ key: 'notes', header: 'السبب / الملاحظات', exportValue: (r) => r.notes || '-', render: (r) => <span className="text-slate-600 max-w-[220px] truncate block">{r.notes || '-'}</span> });
                }

                secColumns.push({
                  key: 'actions',
                  header: 'التفاصيل',
                  align: 'center',
                  render: (r) => (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRow(r);
                      }}
                      className="p-1 rounded-lg bg-slate-100 hover:bg-blue-100 text-blue-900 cursor-pointer"
                      title="عرض تفاصيل المستند"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  ),
                });

                return (
                  <div key={sec.key} className="space-y-1.5">
                    <div className={`px-2.5 py-1.5 rounded-lg border flex flex-wrap items-center justify-between gap-2 ${sec.bannerCls}`}>
                      <div>
                        <h4 className="font-black text-xs sm:text-sm">{sec.title}</h4>
                        <p className="text-[11px] opacity-85">{sec.subtitle}</p>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums">
                        <span className={`px-2 py-0.5 rounded font-bold ${sec.badgeCls}`}>
                          {rows.length} حركة | كمية: {secTotalQty}
                        </span>
                        <span className="font-black">
                          القيمة: {secTotalVal.toLocaleString()} {settings.currency}
                        </span>
                        {sec.key === 'sales' && (
                          <span className="font-black text-emerald-300">
                            الربح: {secTotalProfit.toLocaleString()} {settings.currency}
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
                      exportFilename={`حركة_الصنف_${sec.key}`}
                      pdfTitle={sec.title}
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
              <span className="text-slate-300 text-[10px] block">إجمالي المبيعات (كمية: {report.totals.totalSalesQty})</span>
              <strong className="text-xs font-mono font-black text-sky-200">
                {report.totals.totalSalesValue.toLocaleString()} {settings.currency}
              </strong>
            </div>
            <div>
              <span className="text-slate-300 text-[10px] block">إجمالي المشتريات (كمية: {report.totals.totalPurchaseQty})</span>
              <strong className="text-xs font-mono font-black text-[#DCE6F5]">
                {report.totals.totalPurchaseValue.toLocaleString()} {settings.currency}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-emerald-400" /> الربح (على التكلفة)
              </span>
              <strong className={`text-xs font-mono font-black ${report.totals.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {report.totals.totalProfit.toLocaleString()} {settings.currency}
              </strong>
              <span className="block text-[10px] text-slate-400 font-mono">
                تكلفة المباع: {report.totals.totalCostOfGoodsSold.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] flex items-center gap-1">
                <ArrowDownLeft className="w-3 h-3 text-emerald-400" /> إجمالي الوارد (+)
              </span>
              <strong className="text-xs font-mono font-black text-emerald-300">
                +{report.totals.totalQtyIn}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] flex items-center gap-1">
                <ArrowUpRight className="w-3 h-3 text-rose-400" /> إجمالي المنصرف (-)
              </span>
              <strong className="text-xs font-mono font-black text-rose-300">
                -{report.totals.totalQtyOut}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] block">الرصيد الحالي / التقييم</span>
              <strong className="text-xs font-mono font-black text-white">
                {report.totals.currentBalance} ({report.totals.inventoryValuation.toLocaleString()} {settings.currency})
              </strong>
            </div>
          </div>
        </>
      )}

      {/* Source Document Details Modal */}
      <Modal
        isOpen={Boolean(selectedRow)}
        onClose={() => setSelectedRow(null)}
        title={selectedRow ? `تفاصيل المستند: ${selectedRow.docNumber}` : ''}
        subtitle={selectedRow ? `${selectedRow.docType} · ${selectedRow.date}` : ''}
        maxWidth="2xl"
      >
        {selectedRow && (
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200 tabular-nums">
              <div>
                <span className="text-slate-500 block">الصنف:</span>
                <strong className="text-slate-900">{selectedRow.productName}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">الكمية والوحدة:</span>
                <strong className="font-mono text-blue-950">{selectedRow.quantity} {selectedRow.unit}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">القيمة / التكلفة:</span>
                <strong className="font-mono">{selectedRow.totalValue.toLocaleString()} / {selectedRow.costPrice.toLocaleString()} {settings.currency}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">المستودع:</span>
                <strong>{selectedRow.targetWarehouseName ? `${selectedRow.warehouseName || ''} ⬅ ${selectedRow.targetWarehouseName}` : selectedRow.warehouseName || '-'}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">الطرف / المندوب:</span>
                <strong>{selectedRow.partyName || selectedRow.representativeName || '-'}</strong>
              </div>
              <div>
                <span className="text-slate-500 block">بواسطة:</span>
                <strong>{selectedRow.createdBy || '-'}</strong>
              </div>
            </div>

            {selectedRow.notes && (
              <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-950">
                <strong>ملاحظات:</strong> {selectedRow.notes}
              </div>
            )}

            {sourceDocDetails?.kind === 'invoice' && (
              <UnifiedDataTable
                compact
                searchable={false}
                paginated={false}
                title={`بنود الفاتورة (${sourceDocDetails.data.invoiceNumber}) — الإجمالي: ${sourceDocDetails.data.grandTotal.toLocaleString()} ${settings.currency}`}
                data={sourceDocDetails.data.items.map((it, idx) => ({ ...it, _idx: idx }))}
                rowKey={(it) => `${it.productId}-${it._idx}`}
                columns={[
                  { key: 'productName', header: 'الصنف', render: (it) => <span className="font-bold">{it.productName}</span> },
                  { key: 'unit', header: 'الوحدة', align: 'center', render: (it) => it.unit },
                  { key: 'quantity', header: 'الكمية', align: 'center', render: (it) => <span className="font-mono tabular-nums">{it.quantity}</span> },
                  { key: 'unitPrice', header: 'السعر', align: 'center', render: (it) => <span className="font-mono tabular-nums">{it.unitPrice.toLocaleString()}</span> },
                  { key: 'total', header: 'الإجمالي', align: 'center', render: (it) => <span className="font-mono font-bold text-blue-900 tabular-nums">{it.total.toLocaleString()}</span> },
                ]}
              />
            )}

            {sourceDocDetails?.kind === 'return' && (
              <UnifiedDataTable
                compact
                searchable={false}
                paginated={false}
                title={`بنود المرتجع (${sourceDocDetails.data.returnNumber}) — الإجمالي: ${sourceDocDetails.data.grandTotal.toLocaleString()} ${settings.currency}`}
                data={sourceDocDetails.data.items.map((it, idx) => ({ ...it, _idx: idx }))}
                rowKey={(it) => `${it.productId}-${it._idx}`}
                columns={[
                  { key: 'productName', header: 'الصنف', render: (it) => <span className="font-bold">{it.productName}</span> },
                  { key: 'unit', header: 'الوحدة', align: 'center', render: (it) => it.unit },
                  { key: 'quantity', header: 'الكمية', align: 'center', render: (it) => <span className="font-mono tabular-nums">{it.quantity}</span> },
                  { key: 'total', header: 'الإجمالي', align: 'center', render: (it) => <span className="font-mono font-bold tabular-nums">{it.total.toLocaleString()}</span> },
                ]}
              />
            )}

            {sourceDocDetails?.kind === 'rep_transfer' && (
              <UnifiedDataTable
                compact
                searchable={false}
                paginated={false}
                title={`أصناف إذن عهدة المندوب (${sourceDocDetails.data.requestNumber}) — الحالة: ${sourceDocDetails.data.status}`}
                data={sourceDocDetails.data.items.map((it, idx) => ({ ...it, _idx: idx }))}
                rowKey={(it) => `${it.productId}-${it._idx}`}
                columns={[
                  { key: 'productName', header: 'الصنف', render: (it) => <span className="font-bold">{it.productName}</span> },
                  { key: 'unit', header: 'الوحدة', align: 'center', render: (it) => it.unit },
                  { key: 'requestedQty', header: 'الكمية المطلوبة', align: 'center', render: (it) => <span className="font-mono tabular-nums">{it.requestedQty}</span> },
                  { key: 'executedQty', header: 'المصروفة', align: 'center', render: (it) => <span className="font-mono font-bold tabular-nums">{it.executedQty ?? it.approvedQty ?? it.requestedQty}</span> },
                ]}
              />
            )}

            {sourceDocDetails?.kind === 'stock_transfer' && (
              <UnifiedDataTable
                compact
                searchable={false}
                paginated={false}
                title={`أصناف التحويل المخزني (${sourceDocDetails.data.transferNumber})`}
                data={sourceDocDetails.data.items.map((it, idx) => ({ ...it, _idx: idx }))}
                rowKey={(it) => `${it.productId}-${it._idx}`}
                columns={[
                  { key: 'productName', header: 'الصنف', render: (it) => <span className="font-bold">{it.productName}</span> },
                  { key: 'unit', header: 'الوحدة', align: 'center', render: (it) => it.unit },
                  { key: 'qty', header: 'الكمية', align: 'center', render: (it) => <span className="font-mono font-bold tabular-nums">{it.executedQty ?? it.requestedQty}</span> },
                ]}
              />
            )}

            {sourceDocDetails?.kind === 'rep_custody' && (
              <div className="border border-sky-200 rounded-lg overflow-hidden bg-sky-50/40 p-2.5 space-y-1.5">
                <div className="font-bold text-sky-950">
                  مستند عهدة المندوب ({sourceDocDetails.data.operationNumber}) — {sourceDocDetails.data.operationType}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                  <div>المندوب: <strong>{sourceDocDetails.data.representativeName}</strong></div>
                  <div>الكمية: <strong className="font-mono">{sourceDocDetails.data.quantity} {sourceDocDetails.data.unit}</strong></div>
                  <div>الأساس: <strong className="font-mono">{sourceDocDetails.data.baseQuantity}</strong></div>
                  {sourceDocDetails.data.customerName && (
                    <div>العميل: <strong>{sourceDocDetails.data.customerName}</strong></div>
                  )}
                  {sourceDocDetails.data.targetWarehouseName && (
                    <div>المخزن الوجهة: <strong>{sourceDocDetails.data.targetWarehouseName}</strong></div>
                  )}
                  <div>الحالة: <strong>{sourceDocDetails.data.status}</strong></div>
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
                <span>طباعة المستند</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedRow(null)}
                className="h-8 px-2.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
              >
                إغلاق
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

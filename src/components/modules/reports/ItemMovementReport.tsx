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
  ChevronDown,
  X,
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { ItemMovementReportResponse, ItemMovementRow } from '../../../types';
import { PrintDocumentModal, PrintData } from '../../common/PrintDocument';
import { exportToExcel } from '../../common/ExcelExporter';
import { exportTableToPdf } from '../../common/PdfExporter';
import { Modal } from '../../common/Modal';

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
    bannerCls: 'bg-blue-950 text-white border-blue-900',
    badgeCls: 'bg-blue-800 text-blue-100',
  },
  {
    key: 'purchases',
    title: '2. فواتير المشتريات والتوريدات',
    subtitle: 'الكميات المضافة للمخزون من الموردين وتكلفة الشراء',
    bannerCls: 'bg-purple-900 text-white border-purple-800',
    badgeCls: 'bg-purple-800 text-purple-100',
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
    bannerCls: 'bg-orange-800 text-white border-orange-700',
    badgeCls: 'bg-orange-700 text-orange-100',
  },
  {
    key: 'transfers',
    title: '5. التحويلات المخزنية بين المستودعات',
    subtitle: 'حركات نقل داخلي مستبعدة من إجمالي المبيعات',
    bannerCls: 'bg-indigo-900 text-white border-indigo-800',
    badgeCls: 'bg-indigo-800 text-indigo-100',
  },
  {
    key: 'custody_sent',
    title: '6. صرف عهدة البضاعة من المخزن للمندوب',
    subtitle: 'أذونات الصرف الصادرة من المستودع الرئيسي للمناديب',
    bannerCls: 'bg-cyan-900 text-white border-cyan-800',
    badgeCls: 'bg-cyan-800 text-cyan-100',
  },
  {
    key: 'custody_received',
    title: '7. استلام العهدة في سيارات المناديب',
    subtitle: 'الأذونات المؤكد استلامها فعلياً في عهدة سيارة المندوب',
    bannerCls: 'bg-emerald-900 text-white border-emerald-800',
    badgeCls: 'bg-emerald-800 text-emerald-100',
  },
  {
    key: 'custody_deliveries',
    title: '8. تسليمات وإرجاعات عهدة المناديب',
    subtitle: 'التسليم الجزئي للعملاء أو الإرجاع من السيارة للمخزن',
    bannerCls: 'bg-sky-900 text-white border-sky-800',
    badgeCls: 'bg-sky-800 text-sky-100',
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
  const [productSearchQuery, setProductSearchQuery] = useState<string>('');
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState<boolean>(false);
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

  const normalizeSearch = (val: string) =>
    String(val || '')
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[\u064B-\u065F]/g, '')
      .trim();

  const selectedFilterProduct = useMemo(
    () => (productId && productId !== 'all' ? products.find((p) => p.id === productId) || null : null),
    [products, productId]
  );

  const filteredProductsForSelector = useMemo(() => {
    const q = normalizeSearch(productSearchQuery);
    if (!q) return products.slice(0, 80);
    return products
      .filter((p) => {
        const hay = normalizeSearch(`${p.name} ${p.code} ${p.barcode || ''} ${p.category || ''}`);
        return hay.includes(q);
      })
      .slice(0, 80);
  }, [products, productSearchQuery]);

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
    setProductSearchQuery('');
    setIsProductDropdownOpen(false);
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
    <div className="space-y-4">
      {/* Header & Exports */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-slate-900">تقرير حركة الصنف المفصل والشامل</h3>
          <p className="text-xs text-slate-500">
            متابعة المبيعات والمشتريات والمرتجعات والتحويلات وعهد المناديب والتسويات مع احتساب الأرباح على التكلفة وتقييم المخزون
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={!report}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 font-bold text-slate-700 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={!report}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 font-bold text-red-800 cursor-pointer disabled:opacity-50"
          >
            <FileDown className="w-4 h-4 text-red-700" />
            <span>PDF</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!report}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-50"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة التقرير</span>
          </button>
        </div>
      </div>

      {/* Multi-Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <label className="block font-bold text-slate-600 mb-1">الصنف (بحث بالاسم / الكود / الباركود):</label>
            <div className="relative">
              <input
                type="text"
                value={
                  isProductDropdownOpen
                    ? productSearchQuery
                    : selectedFilterProduct
                    ? `${selectedFilterProduct.name} (${selectedFilterProduct.code})`
                    : ''
                }
                onFocus={() => {
                  setProductSearchQuery('');
                  setIsProductDropdownOpen(true);
                }}
                onChange={(e) => {
                  setProductSearchQuery(e.target.value);
                  setIsProductDropdownOpen(true);
                }}
                placeholder="-- جميع الأصناف (ابحث هنا) --"
                className="w-full p-2 pl-12 pr-3 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white font-bold text-slate-800"
              />
              {productId !== 'all' ? (
                <button
                  type="button"
                  onClick={() => {
                    setProductId('all');
                    setProductSearchQuery('');
                    setIsProductDropdownOpen(false);
                  }}
                  className="absolute left-2 top-1.5 p-1 rounded-lg hover:bg-slate-200 text-slate-500 cursor-pointer"
                  title="عرض كل الأصناف"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
              )}
            </div>
            {isProductDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setIsProductDropdownOpen(false)}
                />
                <div className="absolute right-0 left-0 top-full mt-1 z-30 bg-white border border-slate-300 rounded-xl shadow-xl max-h-64 overflow-y-auto divide-y divide-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setProductId('all');
                      setProductSearchQuery('');
                      setIsProductDropdownOpen(false);
                    }}
                    className={`w-full text-right px-3 py-2 font-black hover:bg-blue-50 cursor-pointer ${
                      productId === 'all' ? 'bg-blue-50 text-blue-900' : 'text-slate-700'
                    }`}
                  >
                    -- جميع الأصناف --
                  </button>
                  {filteredProductsForSelector.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setProductId(p.id);
                        setProductSearchQuery('');
                        setIsProductDropdownOpen(false);
                      }}
                      className={`w-full text-right px-3 py-2 hover:bg-blue-50 cursor-pointer flex items-center justify-between gap-2 ${
                        productId === p.id ? 'bg-blue-50 text-blue-900 font-black' : 'text-slate-800 font-bold'
                      }`}
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="font-mono text-[10px] text-slate-500 shrink-0">{p.code}</span>
                    </button>
                  ))}
                  {filteredProductsForSelector.length === 0 && (
                    <div className="px-3 py-4 text-center text-slate-400 font-bold">
                      لا توجد أصناف مطابقة للبحث
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div>
            <label className="block font-bold text-slate-600 mb-1">المستودع:</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-full p-2 rounded-xl border border-slate-300 bg-slate-50 font-bold"
            >
              <option value="all">-- جميع المستودعات --</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-bold text-slate-600 mb-1">المندوب:</label>
            <select
              value={representativeId}
              onChange={(e) => setRepresentativeId(e.target.value)}
              className="w-full p-2 rounded-xl border border-slate-300 bg-slate-50 font-bold"
            >
              <option value="all">-- جميع المناديب --</option>
              {representatives.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-bold text-slate-600 mb-1">نوع الحركة / القسم:</label>
            <select
              value={movementType}
              onChange={(e) => setMovementType(e.target.value)}
              className="w-full p-2 rounded-xl border border-slate-300 bg-slate-50 font-bold"
            >
              <option value="all">-- كافة أقسام الحركة --</option>
              {SECTION_META.map((sec) => (
                <option key={sec.key} value={sec.key}>{sec.title}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block font-bold text-slate-600 mb-1">من تاريخ:</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full p-2 rounded-xl border border-slate-300 font-mono bg-slate-50"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-600 mb-1">إلى تاريخ:</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full p-2 rounded-xl border border-slate-300 font-mono bg-slate-50"
            />
          </div>
          <div className="lg:col-span-2 relative">
            <label className="block font-bold text-slate-600 mb-1">بحث في المستندات أو الأطراف:</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="رقم فاتورة، عميل، مورد، أو ملاحظات..."
                className="w-full pr-9 pl-3 py-2 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchReport}
              disabled={isLoading}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-bold cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              <span>تحديث</span>
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              className="flex items-center justify-center gap-1 py-2 px-3 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
              title="إعادة ضبط الفلاتر"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs font-bold">
          {error}
        </div>
      )}

      {/* Selected Product Header & Breakdown Strips */}
      {report && (
        <>
          {report.product && (
            <div className="bg-slate-900 text-white p-4 rounded-2xl flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-800 flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="font-black text-sm">{report.product.name}</h4>
                  <p className="text-slate-300 font-mono text-[11px]">
                    كود: {report.product.code} {report.product.barcode ? `| باركود: ${report.product.barcode}` : ''} | الوحدة الأساسية: {report.product.baseUnit}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-5 tabular-nums">
                <div>
                  <span className="text-slate-400 block text-[10px]">سعر الشراء</span>
                  <strong className="font-mono text-sm">{report.product.purchasePrice.toLocaleString()} {settings.currency}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">سعر البيع</span>
                  <strong className="font-mono text-sm text-emerald-300">{report.product.sellingPrice.toLocaleString()} {settings.currency}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">الرصيد الإجمالي</span>
                  <strong className="font-mono text-sm text-blue-300">{report.totals.currentBalance}</strong>
                </div>
              </div>
            </div>
          )}

          {/* Warehouse & Rep Custody Breakdown */}
          {(report.warehouseBreakdown.length > 0 || report.repCustodyBreakdown.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
              {report.warehouseBreakdown.length > 0 && (
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
                  <h4 className="font-black text-slate-900 mb-2 flex items-center gap-1.5">
                    <WarehouseIcon className="w-4 h-4 text-blue-800" />
                    <span>توزيع الأرصدة بالمستودعات ({report.warehouseBreakdown.length})</span>
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 tabular-nums">
                    {report.warehouseBreakdown.map((wh) => (
                      <div key={wh.warehouseId} className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                        <div className="font-bold text-slate-800 truncate">{wh.warehouseName}</div>
                        <div className="font-mono font-black text-blue-950 text-sm mt-0.5">{wh.quantity}</div>
                        <div className="text-[10px] text-slate-500 font-mono">تكلفة: {wh.costValue.toLocaleString()} {settings.currency}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {report.repCustodyBreakdown.length > 0 && (
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
                  <h4 className="font-black text-slate-900 mb-2 flex items-center gap-1.5">
                    <Truck className="w-4 h-4 text-emerald-700" />
                    <span>أرصدة عهد سيارات المناديب ({report.repCustodyBreakdown.length})</span>
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 tabular-nums">
                    {report.repCustodyBreakdown.map((rep) => (
                      <div key={rep.representativeId} className="p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-200">
                        <div className="font-bold text-slate-900 truncate">{rep.representativeName}</div>
                        <div className="font-mono font-black text-emerald-800 text-sm mt-0.5">{rep.quantity}</div>
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
            <div className="bg-white p-10 rounded-2xl border border-slate-200 text-center text-xs text-slate-500 font-bold">
              لا توجد حركات مسجلة تطابق الفلاتر الحالية.
            </div>
          ) : (
            <div className="space-y-4">
              {visibleSections.map((sec) => {
                const rows = report.sections[sec.key] || [];
                const secTotalQty = rows.reduce((s, r) => s + Number(r.quantity || 0), 0);
                const secTotalVal = rows.reduce((s, r) => s + Number(r.totalValue || 0), 0);
                const secTotalProfit = rows.reduce((s, r) => s + Number(r.profitValue || 0), 0);

                return (
                  <div key={sec.key} className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                    <div className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2 ${sec.bannerCls}`}>
                      <div>
                        <h4 className="font-black text-xs sm:text-sm">{sec.title}</h4>
                        <p className="text-[11px] opacity-85">{sec.subtitle}</p>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
                        <span className={`px-2 py-0.5 rounded-md font-bold ${sec.badgeCls}`}>
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

                    <div className="overflow-x-auto">
                      <table className="w-full text-right text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200 whitespace-nowrap">
                            <th className="p-2.5">التاريخ</th>
                            <th className="p-2.5">المستند</th>
                            {(sec.key === 'custody_deliveries' || sec.key === 'adjustments') && (
                              <th className="p-2.5">نوع الحركة</th>
                            )}
                            <th className="p-2.5">الصنف</th>
                            {(sec.key === 'sales' || sec.key === 'sales_returns') && (
                              <>
                                <th className="p-2.5">العميل</th>
                                <th className="p-2.5">المندوب</th>
                                <th className="p-2.5">المستودع</th>
                              </>
                            )}
                            {(sec.key === 'purchases' || sec.key === 'purchase_returns') && (
                              <>
                                <th className="p-2.5">المورد</th>
                                <th className="p-2.5">المستودع</th>
                              </>
                            )}
                            {sec.key === 'transfers' && (
                              <th className="p-2.5">المسار (من ⬅ إلى)</th>
                            )}
                            {(sec.key === 'custody_sent' || sec.key === 'custody_received') && (
                              <>
                                <th className="p-2.5">المندوب</th>
                                <th className="p-2.5">المسار (من ⬅ إلى)</th>
                              </>
                            )}
                            {sec.key === 'custody_deliveries' && (
                              <>
                                <th className="p-2.5">المندوب</th>
                                <th className="p-2.5">العميل / المخزن الوجهة</th>
                              </>
                            )}
                            {sec.key === 'adjustments' && (
                              <th className="p-2.5">المستودع</th>
                            )}
                            <th className="p-2.5 text-center">الكمية والوحدة</th>
                            {(sec.key === 'sales' || sec.key === 'sales_returns') && (
                              <>
                                <th className="p-2.5 text-center">السعر</th>
                                <th className="p-2.5 text-center">التكلفة</th>
                              </>
                            )}
                            {(sec.key === 'purchases' || sec.key === 'purchase_returns') && (
                              <th className="p-2.5 text-center">تكلفة الوحدة</th>
                            )}
                            {sec.key === 'transfers' && (
                              <th className="p-2.5 text-center">التكلفة</th>
                            )}
                            <th className="p-2.5 text-center">
                              {sec.key === 'custody_sent' || sec.key === 'custody_received' || sec.key === 'custody_deliveries'
                                ? 'القيمة بالتكلفة'
                                : 'الإجمالي'}
                            </th>
                            {(sec.key === 'sales' || sec.key === 'sales_returns') && (
                              <th className="p-2.5 text-center">الربح</th>
                            )}
                            {(sec.key === 'transfers' || sec.key === 'custody_sent' || sec.key === 'custody_received') && (
                              <th className="p-2.5">المنفذ</th>
                            )}
                            {sec.key === 'adjustments' && (
                              <th className="p-2.5">السبب / الملاحظات</th>
                            )}
                            <th className="p-2.5 text-center">التفاصيل</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 tabular-nums">
                          {rows.map((r) => (
                            <tr
                              key={r.id}
                              onClick={() => setSelectedRow(r)}
                              className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                            >
                              <td className="p-2.5 font-mono text-slate-600 whitespace-nowrap">{r.date}</td>
                              <td className="p-2.5">
                                <div className="font-mono font-bold text-blue-900">{r.docNumber}</div>
                                <div className="text-[10px] text-slate-500">{r.docType}</div>
                              </td>
                              {(sec.key === 'custody_deliveries' || sec.key === 'adjustments') && (
                                <td className="p-2.5 font-bold text-slate-700 whitespace-nowrap">{r.docType}</td>
                              )}
                              <td className="p-2.5 font-bold text-slate-900">{r.productName}</td>
                              {(sec.key === 'sales' || sec.key === 'sales_returns') && (
                                <>
                                  <td className="p-2.5 text-slate-700">{r.partyName || '-'}</td>
                                  <td className="p-2.5 text-slate-700">{r.representativeName || '-'}</td>
                                  <td className="p-2.5 text-slate-700">{r.warehouseName || '-'}</td>
                                </>
                              )}
                              {(sec.key === 'purchases' || sec.key === 'purchase_returns') && (
                                <>
                                  <td className="p-2.5 text-slate-700">{r.partyName || '-'}</td>
                                  <td className="p-2.5 text-slate-700">{r.warehouseName || '-'}</td>
                                </>
                              )}
                              {sec.key === 'transfers' && (
                                <td className="p-2.5 text-slate-700">
                                  {r.targetWarehouseName
                                    ? `${r.warehouseName || ''} ⬅ ${r.targetWarehouseName}`
                                    : r.warehouseName || '-'}
                                </td>
                              )}
                              {(sec.key === 'custody_sent' || sec.key === 'custody_received') && (
                                <>
                                  <td className="p-2.5 text-slate-700">{r.representativeName || '-'}</td>
                                  <td className="p-2.5 text-slate-700">
                                    {r.targetWarehouseName
                                      ? `${r.warehouseName || ''} ⬅ ${r.targetWarehouseName}`
                                      : r.warehouseName || '-'}
                                  </td>
                                </>
                              )}
                              {sec.key === 'custody_deliveries' && (
                                <>
                                  <td className="p-2.5 text-slate-700">{r.representativeName || '-'}</td>
                                  <td className="p-2.5 text-slate-700">
                                    {r.partyName || r.targetWarehouseName || r.warehouseName || '-'}
                                  </td>
                                </>
                              )}
                              {sec.key === 'adjustments' && (
                                <td className="p-2.5 text-slate-700">{r.warehouseName || '-'}</td>
                              )}
                              <td className="p-2.5 text-center font-mono font-bold whitespace-nowrap">
                                <span
                                  className={
                                    r.direction === 'in'
                                      ? 'text-emerald-700'
                                      : r.direction === 'out'
                                      ? 'text-rose-700'
                                      : 'text-indigo-800'
                                  }
                                >
                                  {r.direction === 'in' ? '+' : r.direction === 'out' ? '-' : ''}
                                  {r.quantity}
                                </span>{' '}
                                <span className="text-[10px] font-sans text-slate-500">{r.unit}</span>
                              </td>
                              {(sec.key === 'sales' || sec.key === 'sales_returns') && (
                                <>
                                  <td className="p-2.5 text-center font-mono">{r.unitPrice.toLocaleString()}</td>
                                  <td className="p-2.5 text-center font-mono text-slate-500">{r.costPrice.toLocaleString()}</td>
                                </>
                              )}
                              {(sec.key === 'purchases' || sec.key === 'purchase_returns') && (
                                <td className="p-2.5 text-center font-mono text-slate-600">{r.unitPrice.toLocaleString()}</td>
                              )}
                              {sec.key === 'transfers' && (
                                <td className="p-2.5 text-center font-mono text-slate-500">{r.costPrice.toLocaleString()}</td>
                              )}
                              <td className="p-2.5 text-center font-mono font-black text-slate-900 whitespace-nowrap">
                                {r.totalValue.toLocaleString()} {settings.currency}
                              </td>
                              {(sec.key === 'sales' || sec.key === 'sales_returns') && (
                                <td
                                  className={`p-2.5 text-center font-mono font-bold whitespace-nowrap ${
                                    r.profitValue > 0
                                      ? 'text-emerald-700'
                                      : r.profitValue < 0
                                      ? 'text-red-700'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {r.profitValue !== 0 ? `${r.profitValue.toLocaleString()}` : '-'}
                                </td>
                              )}
                              {(sec.key === 'transfers' || sec.key === 'custody_sent' || sec.key === 'custody_received') && (
                                <td className="p-2.5 text-slate-600">{r.createdBy || '-'}</td>
                              )}
                              {sec.key === 'adjustments' && (
                                <td className="p-2.5 text-slate-600 max-w-[220px] truncate">{r.notes || '-'}</td>
                              )}
                              <td className="p-2.5 text-center">
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
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Fixed Bottom Summary Bar */}
          <div className="sticky bottom-0 z-20 bg-slate-950 text-white p-4 rounded-2xl shadow-xl border border-slate-800 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs tabular-nums">
            <div>
              <span className="text-slate-400 text-[10px] block">إجمالي المبيعات (كمية: {report.totals.totalSalesQty})</span>
              <strong className="text-sm font-mono font-black text-blue-300">
                {report.totals.totalSalesValue.toLocaleString()} {settings.currency}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] block">إجمالي المشتريات (كمية: {report.totals.totalPurchaseQty})</span>
              <strong className="text-sm font-mono font-black text-purple-300">
                {report.totals.totalPurchaseValue.toLocaleString()} {settings.currency}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-emerald-400" /> الربح (على التكلفة)
              </span>
              <strong className={`text-sm font-mono font-black ${report.totals.totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
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
              <strong className="text-sm font-mono font-black text-emerald-300">
                +{report.totals.totalQtyIn}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] flex items-center gap-1">
                <ArrowUpRight className="w-3 h-3 text-rose-400" /> إجمالي المنصرف (-)
              </span>
              <strong className="text-sm font-mono font-black text-rose-300">
                -{report.totals.totalQtyOut}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] block">الرصيد الحالي / التقييم</span>
              <strong className="text-sm font-mono font-black text-white">
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
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 tabular-nums">
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
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950">
                <strong>ملاحظات:</strong> {selectedRow.notes}
              </div>
            )}

            {sourceDocDetails?.kind === 'invoice' && (
              <div className="border border-slate-200 rounded-xl overflow-hidden awlad-table-scroll">
                <div className="p-2.5 bg-slate-100 font-bold text-slate-800 border-b">
                  بنود الفاتورة ({sourceDocDetails.data.invoiceNumber}) — الإجمالي: {sourceDocDetails.data.grandTotal.toLocaleString()} {settings.currency}
                </div>
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b font-bold">
                      <th className="p-2">الصنف</th>
                      <th className="p-2 text-center">الوحدة</th>
                      <th className="p-2 text-center">الكمية</th>
                      <th className="p-2 text-center">السعر</th>
                      <th className="p-2 text-center">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sourceDocDetails.data.items.map((it, idx) => (
                      <tr key={idx}>
                        <td className="p-2 font-bold">{it.productName}</td>
                        <td className="p-2 text-center">{it.unit}</td>
                        <td className="p-2 text-center font-mono">{it.quantity}</td>
                        <td className="p-2 text-center font-mono">{it.unitPrice.toLocaleString()}</td>
                        <td className="p-2 text-center font-mono font-bold text-blue-900">{it.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {sourceDocDetails?.kind === 'return' && (
              <div className="border border-slate-200 rounded-xl overflow-hidden awlad-table-scroll">
                <div className="p-2.5 bg-amber-50 font-bold text-amber-950 border-b">
                  بنود المرتجع ({sourceDocDetails.data.returnNumber}) — الإجمالي: {sourceDocDetails.data.grandTotal.toLocaleString()} {settings.currency}
                </div>
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b font-bold">
                      <th className="p-2">الصنف</th>
                      <th className="p-2 text-center">الوحدة</th>
                      <th className="p-2 text-center">الكمية</th>
                      <th className="p-2 text-center">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sourceDocDetails.data.items.map((it, idx) => (
                      <tr key={idx}>
                        <td className="p-2 font-bold">{it.productName}</td>
                        <td className="p-2 text-center">{it.unit}</td>
                        <td className="p-2 text-center font-mono">{it.quantity}</td>
                        <td className="p-2 text-center font-mono font-bold">{it.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {sourceDocDetails?.kind === 'rep_transfer' && (
              <div className="border border-slate-200 rounded-xl overflow-hidden awlad-table-scroll">
                <div className="p-2.5 bg-cyan-50 font-bold text-cyan-950 border-b">
                  أصناف إذن عهدة المندوب ({sourceDocDetails.data.requestNumber}) — الحالة: {sourceDocDetails.data.status}
                </div>
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b font-bold">
                      <th className="p-2">الصنف</th>
                      <th className="p-2 text-center">الوحدة</th>
                      <th className="p-2 text-center">الكمية المطلوبة</th>
                      <th className="p-2 text-center">المصروفة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sourceDocDetails.data.items.map((it, idx) => (
                      <tr key={idx}>
                        <td className="p-2 font-bold">{it.productName}</td>
                        <td className="p-2 text-center">{it.unit}</td>
                        <td className="p-2 text-center font-mono">{it.requestedQty}</td>
                        <td className="p-2 text-center font-mono font-bold">{it.executedQty ?? it.approvedQty ?? it.requestedQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {sourceDocDetails?.kind === 'stock_transfer' && (
              <div className="border border-slate-200 rounded-xl overflow-hidden awlad-table-scroll">
                <div className="p-2.5 bg-indigo-50 font-bold text-indigo-950 border-b">
                  أصناف التحويل المخزني ({sourceDocDetails.data.transferNumber})
                </div>
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b font-bold">
                      <th className="p-2">الصنف</th>
                      <th className="p-2 text-center">الوحدة</th>
                      <th className="p-2 text-center">الكمية</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sourceDocDetails.data.items.map((it, idx) => (
                      <tr key={idx}>
                        <td className="p-2 font-bold">{it.productName}</td>
                        <td className="p-2 text-center">{it.unit}</td>
                        <td className="p-2 text-center font-mono font-bold">{it.executedQty ?? it.requestedQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {sourceDocDetails?.kind === 'rep_custody' && (
              <div className="border border-sky-200 rounded-xl overflow-hidden bg-sky-50/40 p-3 space-y-1.5">
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

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handlePrintSelectedSourceDoc}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-bold cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة المستند</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedRow(null)}
                className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
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

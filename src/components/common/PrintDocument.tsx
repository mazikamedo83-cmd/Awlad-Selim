import React, { useState, useEffect } from 'react';
import { Printer, X, FileDown } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { useOptionalShortcuts } from '../../context/ShortcutsContext';
import { usePreferences } from '../../context/PreferencesContext';
import { translateSystemEntityName } from '../../i18n/translator';
import { exportHtmlToPdf } from './PdfExporter';
import { isNativeCapacitor } from '../../services/native';

export interface PrintData {
  title: string;
  docNumber: string;
  docType: string;
  date: string;
  partyName?: string;
  partyPhone?: string;
  partyAddress?: string;
  warehouseName?: string;
  branchName?: string;
  branchNumber?: string;
  representativeName?: string;
  representativePhone?: string;
  paymentType?: string;
  items?: Array<{
    name: string;
    unit: string;
    quantity: number;
    price: number;
    discount?: number;
    total: number;
  }>;
  subtotal?: number;
  discountTotal?: number;
  taxTotal?: number;
  grandTotal: number;
  paidAmount?: number;
  remainingAmount?: number;
  previousBalance?: number;
  currentBalance?: number;
  notes?: string;
  tableHeaders?: string[];
}

interface PrintDocumentProps {
  isOpen: boolean;
  onClose: () => void;
  data: PrintData | null;
}

const noopRegisterHandler = () => () => {};

export const PrintDocumentModal: React.FC<PrintDocumentProps> = ({ isOpen, onClose, data }) => {
  const { settings, representatives, warehouses } = useData();
  const shortcutsCtx = useOptionalShortcuts();
  const registerHandler = shortcutsCtx?.registerHandler ?? noopRegisterHandler;
  const { t, dir } = usePreferences();
  const [printFormat, setPrintFormat] = useState<'a4' | 'thermal80' | 'thermal58'>(settings.defaultPrintMode || 'a4');
  const displayCurrency = settings.currency === 'ج.م' ? t('ج.م', 'EGP') : settings.currency;

  const activeBranches = settings.extraSettings?.branches || [];
  const matchedWarehouse = data?.warehouseName
    ? warehouses.find((w) => w.name === data.warehouseName || w.id === data.warehouseName)
    : undefined;
  const matchedBranch =
    (matchedWarehouse ? activeBranches.find((b) => b.warehouseId === matchedWarehouse.id) : undefined) ||
    activeBranches.find((b) => b.isDefault) ||
    activeBranches[0];
  const resolvedBranchName = (data?.branchName || matchedBranch?.name || '').trim();
  const resolvedBranchNumber = (data?.branchNumber || matchedBranch?.branchNumber || settings.branchNumber || '').trim();
  const resolvedRepPhone = (
    data?.representativePhone ||
    (data?.representativeName ? representatives.find((r) => r.name === data.representativeName)?.phone : '') ||
    ''
  ).trim();
  const resolvedPhonesStr = [settings.phone1?.trim(), settings.phone2?.trim()].filter(Boolean).join(' / ');
  const resolvedAddressStr = (settings.address || '').trim();
  const branchLabelStr = [
    resolvedBranchName,
    resolvedBranchNumber ? `${t('فرع رقم:', 'Branch No:')} ${resolvedBranchNumber}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  useEffect(() => {
    if (isOpen) {
      setPrintFormat(settings.defaultPrintMode || 'a4');
    }
  }, [isOpen, settings.defaultPrintMode]);

  const buildPdfPayload = () => {
    if (!data) return null;
    return {
      title: t(data.docType),
      subtitle: settings.companySubtitle,
      companyName: settings.companyName,
      address: resolvedAddressStr || undefined,
      phone1: settings.phone1?.trim() || undefined,
      phone2: settings.phone2?.trim() || undefined,
      branchName: resolvedBranchName || undefined,
      branchNumber: resolvedBranchNumber || undefined,
      representativeName: data.representativeName?.trim() || undefined,
      representativePhone: resolvedRepPhone || undefined,
      commercialRegistration: settings.commercialRegistration?.trim() || undefined,
      taxNumber: settings.taxNumber?.trim() || undefined,
      docNumber: data.docNumber,
      dateRangeText: data.date,
      meta: [
        ...(data.partyName ? [{ label: t('العميل / الطرف', 'Customer / Party'), value: translateSystemEntityName(data.partyName) }] : []),
        ...(data.partyPhone ? [{ label: t('الهاتف', 'Phone'), value: data.partyPhone }] : []),
        ...(data.partyAddress ? [{ label: t('العنوان', 'Address'), value: data.partyAddress }] : []),
        ...(data.warehouseName ? [{ label: t('المستودع', 'Warehouse'), value: translateSystemEntityName(data.warehouseName) }] : []),
        ...(branchLabelStr ? [{ label: t('الفرع', 'Branch'), value: branchLabelStr }] : []),
        ...(data.representativeName ? [{ label: t('المندوب', 'Representative'), value: data.representativeName }] : []),
        ...(resolvedRepPhone ? [{ label: t('هاتف المندوب', 'Rep Phone'), value: resolvedRepPhone }] : []),
        ...(data.paymentType ? [{ label: t('طريقة السداد', 'Payment Method'), value: t(data.paymentType) }] : []),
      ],
      tableHeaders: data.items && data.items.length > 0
        ? (data.tableHeaders || [
            t('م', '#'),
            t('البيان / الصنف', 'Item Description'),
            t('الوحدة', 'Unit'),
            t('الكمية', 'Qty'),
            t('السعر', 'Price'),
            t('الخصم', 'Discount'),
            t('الإجمالي', 'Total'),
          ])
        : undefined,
      tableRows: data.items && data.items.length > 0
        ? data.items.map((it, idx) => [
            idx + 1,
            it.name,
            t(it.unit),
            it.quantity,
            it.price.toFixed(2),
            it.discount ? it.discount.toFixed(2) : '-',
            it.total.toFixed(2),
          ])
        : undefined,
      summaryPairs: [
        ...(data.subtotal !== undefined ? [{ label: t('المجموع الفرعي', 'Subtotal'), value: `${data.subtotal.toFixed(2)} ${displayCurrency}` }] : []),
        ...(data.discountTotal ? [{ label: t('الخصم', 'Discount'), value: `-${data.discountTotal.toFixed(2)} ${displayCurrency}` }] : []),
        { label: t('الصافي الإجمالي', 'Grand Total'), value: `${data.grandTotal.toFixed(2)} ${displayCurrency}`, highlight: true },
        ...(data.paidAmount !== undefined ? [{ label: t('المدفوع', 'Paid'), value: `${data.paidAmount.toFixed(2)} ${displayCurrency}` }] : []),
        ...(data.remainingAmount !== undefined ? [{ label: t('المتبقي', 'Remaining'), value: `${data.remainingAmount.toFixed(2)} ${displayCurrency}` }] : []),
      ],
      notes: data.notes || settings.invoiceNotes,
    };
  };

  const handlePrint = () => {
    if (isNativeCapacitor()) {
      handleExportPdf();
      return;
    }
    window.print();
  };

  useEffect(() => {
    if (!isOpen || !data) return;
    return registerHandler('action:print_document', () => {
      if (isNativeCapacitor()) {
        const payload = buildPdfPayload();
        if (payload) exportHtmlToPdf(payload);
      } else {
        window.print();
      }
    });
  }, [isOpen, data, registerHandler, settings, resolvedBranchName, resolvedBranchNumber, resolvedRepPhone]);

  if (!isOpen || !data) return null;

  const handleExportPdf = () => {
    const payload = buildPdfPayload();
    if (payload) exportHtmlToPdf(payload);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Screen Backdrop */}
      <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs no-print" onClick={onClose} />

      <div dir={dir} className="flex min-h-full items-center justify-center p-2 sm:p-3 text-start">
        <div className="relative w-full max-w-4xl rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden no-print-wrapper">
          {/* Controls Bar (hidden during actual print) */}
          <div className="flex flex-wrap items-center justify-between border-b border-[#002160] bg-[#011E58] text-white px-4 py-2 no-print gap-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-bold text-xs">{t('معاينة المستند والطباعة:', 'Document Preview & Print:')}</span>
              <div className="flex bg-[#001A49] p-0.5 rounded-lg text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setPrintFormat('a4')}
                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                    printFormat === 'a4' ? 'bg-[#003589] text-white shadow-xs' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {t('ورق قياسي A4', 'Standard A4')}
                </button>
                <button
                  type="button"
                  onClick={() => setPrintFormat('thermal80')}
                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                    printFormat === 'thermal80' ? 'bg-[#003589] text-white shadow-xs' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {t('حراري 80 مم', 'Thermal 80mm')}
                </button>
                <button
                  type="button"
                  onClick={() => setPrintFormat('thermal58')}
                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                    printFormat === 'thermal58' ? 'bg-[#003589] text-white shadow-xs' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {t('حراري 58 مم', 'Thermal 58mm')}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleExportPdf}
                className="flex items-center gap-1.5 bg-[#003589] hover:bg-[#0049B0] text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>{t('تصدير / حفظ PDF', 'Export / Save PDF')}</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-1.5 bg-white text-[#011E58] hover:bg-[#EEF3FA] text-xs font-black px-3 py-1.5 rounded-lg shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{isNativeCapacitor() ? t('مشاركة / حفظ المستند', 'Share / Save Document') : t('طباعة المستند الآن', 'Print Document Now')}</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('إغلاق', 'Close')}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-700 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Printable Document Body */}
          <div className="max-h-[82vh] overflow-y-auto p-3 sm:p-5 bg-slate-100 flex justify-center print-container">
            {/* A4 FORMAT */}
            {printFormat === 'a4' && (
              <div className="w-[210mm] min-h-[297mm] bg-white p-8 shadow-md border border-slate-300 text-slate-900 rounded-sm text-sm print:p-0 print:border-none print:shadow-none print:w-full">
                {/* Header with Official Logo */}
                <div className="flex items-center justify-between border-b-2 border-blue-900 pb-5">
                  <div className="w-48">
                    <img 
                      src="/awlad-selim-logo.png" 
                      alt="AWLAD SELIM" 
                      className="max-h-20 object-contain"
                    />
                  </div>
                  <div className="text-center flex-1 px-4">
                    <h1 className="text-2xl font-black text-blue-950 tracking-tight">{settings.companyName}</h1>
                    {settings.companySubtitle?.trim() && (
                      <p className="text-xs font-semibold text-slate-600 mt-1">{settings.companySubtitle}</p>
                    )}
                    {branchLabelStr && (
                      <p className="text-[11px] font-bold text-blue-900 mt-0.5">{branchLabelStr}</p>
                    )}
                    {(resolvedAddressStr || resolvedPhonesStr) && (
                      <div className="text-[11px] text-slate-500 mt-1.5 flex flex-wrap justify-center gap-3">
                        {resolvedAddressStr && <span>{resolvedAddressStr}</span>}
                        {resolvedAddressStr && resolvedPhonesStr && <span>•</span>}
                        {resolvedPhonesStr && <span>{t('هاتف:', 'Tel:')} {resolvedPhonesStr}</span>}
                      </div>
                    )}
                  </div>
                  <div className="w-44 text-end font-mono text-xs text-slate-600 space-y-1">
                    <div className="bg-blue-50 border border-blue-200 p-2 rounded-lg text-center">
                      <span className="block font-bold text-blue-900 text-sm">{t(data.docType)}</span>
                      <span className="font-extrabold text-blue-700 text-base">{data.docNumber}</span>
                    </div>
                  </div>
                </div>

                {/* Document & Party Meta */}
                <div className="grid grid-cols-2 gap-4 my-4 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  <div className="space-y-1.5">
                    <div className="flex"><span className="text-slate-500 w-28">{t('العميل / الطرف:', 'Customer / Party:')}</span><strong className="text-slate-800 text-sm">{data.partyName ? translateSystemEntityName(data.partyName) : t('نقدي / عام', 'Cash / Walk-in')}</strong></div>
                    {data.partyPhone && <div className="flex"><span className="text-slate-500 w-28">{t('رقم الهاتف:', 'Phone:')}</span><span>{data.partyPhone}</span></div>}
                    {data.partyAddress && <div className="flex"><span className="text-slate-500 w-28">{t('العنوان:', 'Address:')}</span><span>{data.partyAddress}</span></div>}
                    {data.representativeName && <div className="flex"><span className="text-slate-500 w-28">{t('المندوب المسؤول:', 'Representative:')}</span><strong className="text-blue-800">{data.representativeName}</strong></div>}
                    {resolvedRepPhone && <div className="flex"><span className="text-slate-500 w-28">{t('هاتف المندوب:', 'Rep Phone:')}</span><span className="font-mono font-bold text-blue-900">{resolvedRepPhone}</span></div>}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex"><span className="text-slate-500 w-28">{t('تاريخ التحرير:', 'Issue Date:')}</span><strong>{data.date}</strong></div>
                    {data.warehouseName && <div className="flex"><span className="text-slate-500 w-28">{t('المستودع المصروف:', 'Warehouse:')}</span><span>{translateSystemEntityName(data.warehouseName)}</span></div>}
                    {branchLabelStr && <div className="flex"><span className="text-slate-500 w-28">{t('الفرع:', 'Branch:')}</span><span className="font-semibold">{branchLabelStr}</span></div>}
                    {data.paymentType && <div className="flex"><span className="text-slate-500 w-28">{t('نوع الدفع:', 'Payment Type:')}</span><span className="px-2 py-0.5 rounded bg-slate-200 font-bold">{t(data.paymentType)}</span></div>}
                  </div>
                </div>

                {/* Items Table */}
                {data.items && data.items.length > 0 && (
                  <table className="w-full text-start border-collapse text-xs my-4">
                    <thead>
                      <tr className="bg-blue-950 text-white font-bold">
                        <th className="p-2 border border-blue-900 text-center w-10">{data.tableHeaders?.[0] || t('م', '#')}</th>
                        <th className="p-2 border border-blue-900">{data.tableHeaders?.[1] || t('بيان الصنف والسلعة الغذائية', 'Item Description')}</th>
                        <th className="p-2 border border-blue-900 text-center w-24">{data.tableHeaders?.[2] || t('الوحدة', 'Unit')}</th>
                        <th className="p-2 border border-blue-900 text-center w-20">{data.tableHeaders?.[3] || t('الكمية', 'Qty')}</th>
                        <th className="p-2 border border-blue-900 text-center w-24">{data.tableHeaders?.[4] || t('سعر الوحدة', 'Unit Price')}</th>
                        <th className="p-2 border border-blue-900 text-center w-20">{data.tableHeaders?.[5] || t('الخصم', 'Discount')}</th>
                        <th className="p-2 border border-blue-900 text-center w-28">{data.tableHeaders?.[6] || t('الإجمالي', 'Total')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {data.items.map((item, idx) => (
                        <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          <td className="p-2 border border-slate-200 text-center font-bold text-slate-500">{idx + 1}</td>
                          <td className="p-2 border border-slate-200 font-semibold">{item.name}</td>
                          <td className="p-2 border border-slate-200 text-center text-slate-600">{t(item.unit)}</td>
                          <td className="p-2 border border-slate-200 text-center font-bold">{item.quantity}</td>
                          <td className="p-2 border border-slate-200 text-center">{item.price.toFixed(2)}</td>
                          <td className="p-2 border border-slate-200 text-center text-slate-500">{item.discount ? item.discount.toFixed(2) : '-'}</td>
                          <td className="p-2 border border-slate-200 text-center font-bold text-blue-950">{item.total.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Totals Summary */}
                <div className="flex justify-between items-start gap-6 mt-4">
                  <div className="flex-1 text-xs text-slate-600 border border-slate-200 rounded-xl p-3 bg-slate-50">
                    <p className="font-bold text-slate-800 mb-1">{t('ملاحظات وشروط الفاتورة:', 'Invoice Notes & Terms:')}</p>
                    <p className="leading-relaxed">{data.notes || settings.invoiceNotes}</p>
                    <div className="mt-3 pt-3 border-t border-slate-200 flex justify-between text-[11px] text-slate-500 font-mono">
                      <span>{settings.commercialRegistration}</span>
                      <span>{settings.taxNumber}</span>
                    </div>
                  </div>

                  <div className="w-72 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-2">
                    {data.subtotal !== undefined && (
                      <div className="flex justify-between text-slate-600">
                        <span>{t('المجموع الفرعي:', 'Subtotal:')}</span>
                        <span className="font-semibold">{data.subtotal.toFixed(2)} {displayCurrency}</span>
                      </div>
                    )}
                    {data.discountTotal !== undefined && data.discountTotal > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>{t('إجمالي الخصم:', 'Total Discount:')}</span>
                        <span className="font-semibold">-{data.discountTotal.toFixed(2)} {displayCurrency}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-black text-blue-950 pt-2 border-t border-slate-300">
                      <span>{t('الصافي الإجمالي:', 'Grand Total:')}</span>
                      <span>{data.grandTotal.toFixed(2)} {displayCurrency}</span>
                    </div>
                    {data.paidAmount !== undefined && (
                      <div className="flex justify-between text-emerald-700 font-bold pt-1">
                        <span>{t('المبلغ المدفوع:', 'Paid Amount:')}</span>
                        <span>{data.paidAmount.toFixed(2)} {displayCurrency}</span>
                      </div>
                    )}
                    {data.remainingAmount !== undefined && (
                      <div className="flex justify-between text-red-700 font-bold pt-1">
                        <span>{t('المبلغ المتبقي:', 'Remaining Amount:')}</span>
                        <span>{data.remainingAmount.toFixed(2)} {displayCurrency}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Signatures */}
                <div className="grid grid-cols-3 gap-6 text-center text-xs mt-12 pt-6 border-t border-slate-200">
                  <div>
                    <span className="block text-slate-500 font-semibold mb-8">{t('المستلم / العميل', 'Recipient / Customer')}</span>
                    <span className="border-t border-slate-400 block pt-1 text-slate-400">{t('التوقيع / البصمة', 'Signature')}</span>
                  </div>
                  <div>
                    <span className="block text-slate-500 font-semibold mb-8">{t('أمين المستودع / المحاسب', 'Warehouse / Accountant')}</span>
                    <span className="border-t border-slate-400 block pt-1 text-slate-400">{t('التوقيع', 'Signature')}</span>
                  </div>
                  <div>
                    <span className="block text-slate-500 font-semibold mb-8">{t('ختم مؤسسة أولاد سليم', 'AWLAD SELIM Stamp')}</span>
                    <div className="w-20 h-10 border-2 border-dashed border-blue-300 rounded-lg mx-auto flex items-center justify-center text-[10px] text-blue-400">
                      {t('ختم الإدارة', 'Official Stamp')}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* THERMAL 80MM FORMAT */}
            {printFormat === 'thermal80' && (
              <div className="thermal-80 bg-white p-3 shadow-md border border-slate-300 text-slate-900 rounded-sm font-sans text-xs">
                <div className="text-center pb-2 border-b border-dashed border-slate-400">
                  <img 
                    src="/awlad-selim-logo.png" 
                    alt="AWLAD SELIM" 
                    className="max-h-12 mx-auto object-contain mb-1"
                  />
                  <h2 className="font-extrabold text-sm">{settings.companyName}</h2>
                  {branchLabelStr && <p className="text-[10px] font-bold text-slate-700">{branchLabelStr}</p>}
                  {resolvedPhonesStr && <p className="text-[10px] text-slate-600">{resolvedPhonesStr}</p>}
                  {resolvedAddressStr && <p className="text-[10px] text-slate-500">{resolvedAddressStr}</p>}
                </div>

                <div className="my-2 py-1 border-b border-dashed border-slate-400 text-[11px] space-y-0.5">
                  <div className="flex justify-between font-bold text-blue-900">
                    <span>{t(data.docType)}:</span>
                    <span>{data.docNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('التاريخ:', 'Date:')}</span>
                    <span>{data.date}</span>
                  </div>
                  {data.partyName && (
                    <div className="flex justify-between font-semibold">
                      <span>{t('العميل:', 'Customer:')}</span>
                      <span>{translateSystemEntityName(data.partyName)}</span>
                    </div>
                  )}
                  {data.representativeName && (
                    <div className="flex justify-between">
                      <span>{t('المندوب:', 'Rep:')}</span>
                      <span>{data.representativeName}</span>
                    </div>
                  )}
                  {resolvedRepPhone && (
                    <div className="flex justify-between">
                      <span>{t('هاتف المندوب:', 'Rep Phone:')}</span>
                      <span className="font-mono">{resolvedRepPhone}</span>
                    </div>
                  )}
                </div>

                {/* Items */}
                {data.items && (
                  <table className="w-full text-start text-[10px] my-2">
                    <thead>
                      <tr className="border-b border-slate-300 font-bold">
                        <th className="py-1">{t('الصنف', 'Item')}</th>
                        <th className="py-1 text-center">{t('الكمية', 'Qty')}</th>
                        <th className="py-1 text-center">{t('السعر', 'Price')}</th>
                        <th className="py-1 text-end">{t('المجموع', 'Total')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.items.map((item, i) => (
                        <tr key={i}>
                          <td className="py-1 font-medium">{item.name}</td>
                          <td className="py-1 text-center">{item.quantity} {t(item.unit)}</td>
                          <td className="py-1 text-center">{item.price.toFixed(1)}</td>
                          <td className="py-1 text-end font-bold">{item.total.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Totals */}
                <div className="border-t-2 border-slate-800 pt-1.5 text-[11px] space-y-1">
                  <div className="flex justify-between font-black text-sm">
                    <span>{t('الإجمالي:', 'Total:')}</span>
                    <span>{data.grandTotal.toFixed(2)} {displayCurrency}</span>
                  </div>
                  {data.paidAmount !== undefined && (
                    <div className="flex justify-between font-bold text-emerald-700">
                      <span>{t('المدفوع:', 'Paid:')}</span>
                      <span>{data.paidAmount.toFixed(2)}</span>
                    </div>
                  )}
                  {data.remainingAmount !== undefined && (
                    <div className="flex justify-between font-bold text-red-700">
                      <span>{t('المتبقي:', 'Remaining:')}</span>
                      <span>{data.remainingAmount.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                <div className="text-center text-[9px] text-slate-500 mt-3 pt-2 border-t border-dashed border-slate-400">
                  <p>{t('شكراً لتعاملكم مع مؤسسة أولاد سليم', 'Thank you for doing business with AWLAD SELIM')}</p>
                  <p className="mt-0.5">{t('نسعد دائماً بخدمتكم', 'Always happy to serve you')}</p>
                </div>
              </div>
            )}

            {/* THERMAL 58MM FORMAT */}
            {printFormat === 'thermal58' && (
              <div className="thermal-58 bg-white p-2 shadow-md border border-slate-300 text-slate-900 rounded-sm font-sans text-[10px]">
                <div className="text-center pb-1 border-b border-dashed border-slate-400">
                  <h3 className="font-black text-xs">{settings.companyName || t('أولاد سليم', 'AWLAD SELIM')}</h3>
                  {resolvedBranchNumber && <p className="text-[9px] font-bold">{t('فرع رقم:', 'Branch No:')} {resolvedBranchNumber}</p>}
                  {resolvedPhonesStr && <p className="text-[8px] text-slate-600">{resolvedPhonesStr}</p>}
                  <p className="text-[9px]">{t(data.docType)}: {data.docNumber}</p>
                  <p className="text-[8px]">{data.date}</p>
                </div>

                {data.partyName && (
                  <p className="font-bold my-1 text-[9px]">{t('العميل:', 'Customer:')} {translateSystemEntityName(data.partyName)}</p>
                )}
                {(data.representativeName || resolvedRepPhone) && (
                  <p className="my-0.5 text-[9px] text-slate-700">
                    {[
                      data.representativeName ? `${t('المندوب:', 'Rep:')} ${data.representativeName}` : '',
                      resolvedRepPhone ? `${t('ت:', 'Tel:')} ${resolvedRepPhone}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}

                {data.items && (
                  <div className="divide-y divide-slate-200 my-1 text-[9px]">
                    {data.items.map((item, idx) => (
                      <div key={idx} className="py-1">
                        <div className="font-semibold">{item.name}</div>
                        <div className="flex justify-between text-slate-600">
                          <span>{item.quantity} × {item.price.toFixed(1)}</span>
                          <span className="font-bold text-black">{item.total.toFixed(1)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="border-t border-black pt-1 text-[10px] font-black space-y-0.5">
                  <div className="flex justify-between">
                    <span>{t('الإجمالي:', 'Total:')}</span>
                    <span>{data.grandTotal.toFixed(2)} {displayCurrency}</span>
                  </div>
                  {data.paidAmount !== undefined && (
                    <div className="flex justify-between text-emerald-800">
                      <span>{t('المدفوع:', 'Paid:')}</span>
                      <span>{data.paidAmount.toFixed(2)}</span>
                    </div>
                  )}
                  {data.remainingAmount !== undefined && (
                    <div className="flex justify-between text-red-800">
                      <span>{t('المتبقي:', 'Remaining:')}</span>
                      <span>{data.remainingAmount.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                <div className="text-center text-[8px] text-slate-500 mt-2 pt-1 border-t border-dashed border-slate-300">
                  {t('شكراً لتعاملكم معنا', 'Thank you for your business')}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

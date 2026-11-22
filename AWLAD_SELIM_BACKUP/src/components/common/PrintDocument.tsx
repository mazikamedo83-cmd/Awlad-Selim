import React, { useState } from 'react';
import { Printer, X, FileText, Check } from 'lucide-react';
import { useData } from '../../context/DataContext';

export interface PrintData {
  title: string;
  docNumber: string;
  docType: 'فاتورة مبيعات' | 'فاتورة مشتريات' | 'مرتجع مبيعات' | 'مرتجع مشتريات' | 'سند قبض' | 'سند صرف' | 'كشف حساب' | 'إيصال استلام';
  date: string;
  partyName?: string;
  partyPhone?: string;
  partyAddress?: string;
  warehouseName?: string;
  representativeName?: string;
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
}

interface PrintDocumentProps {
  isOpen: boolean;
  onClose: () => void;
  data: PrintData | null;
}

export const PrintDocumentModal: React.FC<PrintDocumentProps> = ({ isOpen, onClose, data }) => {
  const { settings } = useData();
  const [printFormat, setPrintFormat] = useState<'a4' | 'thermal80' | 'thermal58'>(settings.defaultPrintMode || 'a4');

  if (!isOpen || !data) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Screen Backdrop */}
      <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs no-print" onClick={onClose} />

      <div className="flex min-h-full items-center justify-center p-2 sm:p-4 text-right">
        <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden no-print-wrapper">
          {/* Controls Bar (hidden during actual print) */}
          <div className="flex flex-wrap items-center justify-between border-b border-slate-200 bg-slate-800 text-white px-6 py-3.5 no-print">
            <div className="flex items-center gap-3">
              <span className="font-bold text-sm">معاينة المستند والطباعة:</span>
              <div className="flex bg-slate-700 p-0.5 rounded-lg text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setPrintFormat('a4')}
                  className={`px-3 py-1.5 rounded-md transition-all ${
                    printFormat === 'a4' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  ورق قياسي A4
                </button>
                <button
                  type="button"
                  onClick={() => setPrintFormat('thermal80')}
                  className={`px-3 py-1.5 rounded-md transition-all ${
                    printFormat === 'thermal80' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  حراري 80 مم
                </button>
                <button
                  type="button"
                  onClick={() => setPrintFormat('thermal58')}
                  className={`px-3 py-1.5 rounded-md transition-all ${
                    printFormat === 'thermal58' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  حراري 58 مم
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-2 sm:mt-0">
              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold px-4 py-2 rounded-xl shadow-md transition-all active:scale-95"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة المستند الآن</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Printable Document Body */}
          <div className="max-h-[80vh] overflow-y-auto p-4 sm:p-8 bg-slate-100 flex justify-center print-container">
            {/* A4 FORMAT */}
            {printFormat === 'a4' && (
              <div className="w-[210mm] min-h-[297mm] bg-white p-8 shadow-md border border-slate-300 text-slate-900 rounded-sm text-sm print:p-0 print:border-none print:shadow-none print:w-full">
                {/* Header with Official Logo */}
                <div className="flex items-center justify-between border-b-2 border-blue-900 pb-5">
                  <div className="w-48">
                    <img 
                      src="/awlad-selim-logo.png" 
                      alt="أولاد سليم AWLAD SELIM" 
                      className="max-h-20 object-contain"
                    />
                  </div>
                  <div className="text-center flex-1 px-4">
                    <h1 className="text-2xl font-black text-blue-950 tracking-tight">{settings.companyName}</h1>
                    <p className="text-xs font-semibold text-slate-600 mt-1">{settings.companySubtitle}</p>
                    <div className="text-[11px] text-slate-500 mt-1.5 flex flex-wrap justify-center gap-3">
                      <span>{settings.address}</span>
                      <span>•</span>
                      <span>هاتف: {settings.phone1} / {settings.phone2}</span>
                    </div>
                  </div>
                  <div className="w-44 text-left font-mono text-xs text-slate-600 space-y-1">
                    <div className="bg-blue-50 border border-blue-200 p-2 rounded-lg text-center">
                      <span className="block font-bold text-blue-900 text-sm">{data.docType}</span>
                      <span className="font-extrabold text-blue-700 text-base">{data.docNumber}</span>
                    </div>
                  </div>
                </div>

                {/* Document & Party Meta */}
                <div className="grid grid-cols-2 gap-4 my-4 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                  <div className="space-y-1.5">
                    <div className="flex"><span className="text-slate-500 w-24">العميل / الطرف:</span><strong className="text-slate-800 text-sm">{data.partyName || 'نقدي / عام'}</strong></div>
                    {data.partyPhone && <div className="flex"><span className="text-slate-500 w-24">رقم الهاتف:</span><span>{data.partyPhone}</span></div>}
                    {data.partyAddress && <div className="flex"><span className="text-slate-500 w-24">العنوان:</span><span>{data.partyAddress}</span></div>}
                    {data.representativeName && <div className="flex"><span className="text-slate-500 w-24">المندوب المسؤول:</span><strong className="text-blue-800">{data.representativeName}</strong></div>}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex"><span className="text-slate-500 w-24">تاريخ التحرير:</span><strong>{data.date}</strong></div>
                    {data.warehouseName && <div className="flex"><span className="text-slate-500 w-24">المستودع المصروف:</span><span>{data.warehouseName}</span></div>}
                    {data.paymentType && <div className="flex"><span className="text-slate-500 w-24">نوع الدفع:</span><span className="px-2 py-0.5 rounded bg-slate-200 font-bold">{data.paymentType}</span></div>}
                  </div>
                </div>

                {/* Items Table */}
                {data.items && data.items.length > 0 && (
                  <table className="w-full text-right border-collapse text-xs my-4">
                    <thead>
                      <tr className="bg-blue-950 text-white font-bold">
                        <th className="p-2 border border-blue-900 text-center w-10">م</th>
                        <th className="p-2 border border-blue-900">بيان الصنف والسلعة الغذائية</th>
                        <th className="p-2 border border-blue-900 text-center w-24">الوحدة</th>
                        <th className="p-2 border border-blue-900 text-center w-20">الكمية</th>
                        <th className="p-2 border border-blue-900 text-center w-24">سعر الوحدة</th>
                        <th className="p-2 border border-blue-900 text-center w-20">الخصم</th>
                        <th className="p-2 border border-blue-900 text-center w-28">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {data.items.map((item, idx) => (
                        <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          <td className="p-2 border border-slate-200 text-center font-bold text-slate-500">{idx + 1}</td>
                          <td className="p-2 border border-slate-200 font-semibold">{item.name}</td>
                          <td className="p-2 border border-slate-200 text-center text-slate-600">{item.unit}</td>
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
                    <p className="font-bold text-slate-800 mb-1">ملاحظات وشروط الفاتورة:</p>
                    <p className="leading-relaxed">{data.notes || settings.invoiceNotes}</p>
                    <div className="mt-3 pt-3 border-t border-slate-200 flex justify-between text-[11px] text-slate-500 font-mono">
                      <span>{settings.commercialRegistration}</span>
                      <span>{settings.taxNumber}</span>
                    </div>
                  </div>

                  <div className="w-72 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-2">
                    {data.subtotal !== undefined && (
                      <div className="flex justify-between text-slate-600">
                        <span>المجموع الفرعي:</span>
                        <span className="font-semibold">{data.subtotal.toFixed(2)} {settings.currency}</span>
                      </div>
                    )}
                    {data.discountTotal !== undefined && data.discountTotal > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>إجمالي الخصم:</span>
                        <span className="font-semibold">-{data.discountTotal.toFixed(2)} {settings.currency}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-black text-blue-950 pt-2 border-t border-slate-300">
                      <span>الصافي الإجمالي:</span>
                      <span>{data.grandTotal.toFixed(2)} {settings.currency}</span>
                    </div>
                    {data.paidAmount !== undefined && (
                      <div className="flex justify-between text-emerald-700 font-bold pt-1">
                        <span>المبلغ المدفوع:</span>
                        <span>{data.paidAmount.toFixed(2)} {settings.currency}</span>
                      </div>
                    )}
                    {data.remainingAmount !== undefined && (
                      <div className="flex justify-between text-red-700 font-bold pt-1">
                        <span>المبلغ المتبقي:</span>
                        <span>{data.remainingAmount.toFixed(2)} {settings.currency}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Signatures */}
                <div className="grid grid-cols-3 gap-6 text-center text-xs mt-12 pt-6 border-t border-slate-200">
                  <div>
                    <span className="block text-slate-500 font-semibold mb-8">المستلم / العميل</span>
                    <span className="border-t border-slate-400 block pt-1 text-slate-400">التوقيع / البصمة</span>
                  </div>
                  <div>
                    <span className="block text-slate-500 font-semibold mb-8">أمين المستودع / المحاسب</span>
                    <span className="border-t border-slate-400 block pt-1 text-slate-400">التوقيع</span>
                  </div>
                  <div>
                    <span className="block text-slate-500 font-semibold mb-8">ختم مؤسسة أولاد سليم</span>
                    <div className="w-20 h-10 border-2 border-dashed border-blue-300 rounded-lg mx-auto flex items-center justify-center text-[10px] text-blue-400">
                      ختم الإدارة
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
                    alt="أولاد سليم" 
                    className="max-h-12 mx-auto object-contain mb-1"
                  />
                  <h2 className="font-extrabold text-sm">{settings.companyName}</h2>
                  <p className="text-[10px] text-slate-600">{settings.phone1} - {settings.phone2}</p>
                </div>

                <div className="my-2 py-1 border-b border-dashed border-slate-400 text-[11px] space-y-0.5">
                  <div className="flex justify-between font-bold text-blue-900">
                    <span>{data.docType}:</span>
                    <span>{data.docNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>التاريخ:</span>
                    <span>{data.date}</span>
                  </div>
                  {data.partyName && (
                    <div className="flex justify-between font-semibold">
                      <span>العميل:</span>
                      <span>{data.partyName}</span>
                    </div>
                  )}
                  {data.representativeName && (
                    <div className="flex justify-between">
                      <span>المندوب:</span>
                      <span>{data.representativeName}</span>
                    </div>
                  )}
                </div>

                {/* Items */}
                {data.items && (
                  <table className="w-full text-right text-[10px] my-2">
                    <thead>
                      <tr className="border-b border-slate-300 font-bold">
                        <th className="py-1">الصنف</th>
                        <th className="py-1 text-center">الكمية</th>
                        <th className="py-1 text-center">السعر</th>
                        <th className="py-1 text-left">المجموع</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.items.map((item, i) => (
                        <tr key={i}>
                          <td className="py-1 font-medium">{item.name}</td>
                          <td className="py-1 text-center">{item.quantity} {item.unit}</td>
                          <td className="py-1 text-center">{item.price.toFixed(1)}</td>
                          <td className="py-1 text-left font-bold">{item.total.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Totals */}
                <div className="border-t-2 border-slate-800 pt-1.5 text-[11px] space-y-1">
                  <div className="flex justify-between font-black text-sm">
                    <span>الإجمالي:</span>
                    <span>{data.grandTotal.toFixed(2)} {settings.currency}</span>
                  </div>
                  {data.paidAmount !== undefined && (
                    <div className="flex justify-between font-bold text-emerald-700">
                      <span>المدفوع:</span>
                      <span>{data.paidAmount.toFixed(2)}</span>
                    </div>
                  )}
                  {data.remainingAmount !== undefined && (
                    <div className="flex justify-between font-bold text-red-700">
                      <span>المتبقي:</span>
                      <span>{data.remainingAmount.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                <div className="text-center text-[9px] text-slate-500 mt-3 pt-2 border-t border-dashed border-slate-400">
                  <p>شكراً لتعاملكم مع مؤسسة أولاد سليم</p>
                  <p className="mt-0.5">نسعد دائماً بخدمتكم</p>
                </div>
              </div>
            )}

            {/* THERMAL 58MM FORMAT */}
            {printFormat === 'thermal58' && (
              <div className="thermal-58 bg-white p-2 shadow-md border border-slate-300 text-slate-900 rounded-sm font-sans text-[10px]">
                <div className="text-center pb-1 border-b border-dashed border-slate-400">
                  <h3 className="font-black text-xs">أولاد سليم</h3>
                  <p className="text-[9px]">{data.docType}: {data.docNumber}</p>
                  <p className="text-[8px]">{data.date}</p>
                </div>

                {data.partyName && (
                  <p className="font-bold my-1 text-[9px]">العميل: {data.partyName}</p>
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
                    <span>الإجمالي:</span>
                    <span>{data.grandTotal.toFixed(2)} ج.م</span>
                  </div>
                  {data.paidAmount !== undefined && (
                    <div className="flex justify-between text-emerald-800">
                      <span>المدفوع:</span>
                      <span>{data.paidAmount.toFixed(2)}</span>
                    </div>
                  )}
                  {data.remainingAmount !== undefined && (
                    <div className="flex justify-between text-red-800">
                      <span>المتبقي:</span>
                      <span>{data.remainingAmount.toFixed(2)}</span>
                    </div>
                  )}
                </div>

                <div className="text-center text-[8px] text-slate-500 mt-2 pt-1 border-t border-dashed border-slate-300">
                  شكراً لتعاملكم معنا
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { X, Printer, FileText, History, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { ReportSourceDocumentResponse } from '../../../types';

interface SourceDocumentModalProps {
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;
  data: ReportSourceDocumentResponse | null;
  currency: string;
  onClose: () => void;
  onPrint?: (doc: ReportSourceDocumentResponse) => void;
}

export const SourceDocumentModal: React.FC<SourceDocumentModalProps> = ({
  isOpen,
  isLoading,
  error,
  data,
  currency,
  onClose,
  onPrint,
}) => {
  if (!isOpen) return null;

  const doc = data?.document || {};
  const isInvoice = data?.docType === 'sales_invoice' || data?.docType === 'purchase_invoice';
  const isReturn = data?.docType === 'sales_return' || data?.docType === 'purchase_return';
  const isDamaged = data?.docType === 'damaged_voucher';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-5" dir="rtl">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-800 text-white">
          <div className="flex items-center gap-2.5">
            <FileText className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="font-extrabold text-sm sm:text-base">
                {isLoading ? 'جاري تحميل المستند الأصلي...' : data?.title || 'تفاصيل المستند الأصلي'}
              </h3>
              {doc.actualDateTime && (
                <p className="text-[11px] text-slate-300 font-mono">{doc.actualDateTime}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data && onPrint && (
              <button
                type="button"
                onClick={() => onPrint(data)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoading && (
            <div className="py-12 text-center text-slate-500 text-sm font-bold">جاري استرجاع بيانات المستند من قاعدة البيانات...</div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm font-bold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!isLoading && !error && data && (
            <>
              {/* Status Badges */}
              {doc.status === 'cancelled' && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center justify-between">
                  <span>مستند ملغى بواسطة: {doc.cancelledBy || '-'} ({doc.cancelReason || 'بدون سبب مسجل'})</span>
                  <span className="font-mono">{doc.cancelledAt ? String(doc.cancelledAt).split('T')[0] : ''}</span>
                </div>
              )}
              {doc.editedBy && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold flex items-center justify-between">
                  <span>تم تعديل هذا المستند بواسطة: {doc.editedBy}</span>
                  <span className="font-mono">{doc.editedAt ? String(doc.editedAt).split('T')[0] : ''}</span>
                </div>
              )}

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs">
                <div>
                  <span className="text-slate-500 block">رقم المستند</span>
                  <strong className="font-mono text-slate-900">{doc.invoiceNumber || doc.returnNumber || doc.docNumber || doc.transactionNumber || doc.movementNumber || '-'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">تاريخ اليومية</span>
                  <strong className="font-mono text-slate-900">{doc.date || '-'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">الفرع / المستودع</span>
                  <strong className="text-slate-900">{doc.branchName || '-'}{doc.warehouseName ? ` — ${doc.warehouseName}` : ''}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">الخزنة</span>
                  <strong className="text-slate-900">{doc.cashboxName || '-'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">الطرف / الجهة</span>
                  <strong className="text-slate-900">{doc.customerName || doc.supplierName || doc.partyName || doc.relatedEntityName || '-'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">المندوب / الموظف</span>
                  <strong className="text-slate-900">{doc.representativeName || doc.createdBy || '-'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">المستخدم المنشئ</span>
                  <strong className="text-slate-900">{doc.createdBy || '-'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">الحالة / نوع السداد</span>
                  <strong className="text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {doc.status === 'cancelled'
                      ? 'ملغى'
                      : doc.paymentType === 'cash'
                      ? 'نقدي'
                      : doc.paymentType === 'partial'
                      ? 'سداد جزئي'
                      : doc.paymentType === 'credit'
                      ? 'آجل'
                      : doc.refundType === 'cash'
                      ? 'رد نقدي'
                      : doc.refundType === 'balance'
                      ? 'خصم من الرصيد'
                      : 'معتمد'}
                  </strong>
                </div>
              </div>

              {/* Items Table for Invoices / Returns / Damaged */}
              {Array.isArray(doc.items) && doc.items.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-right text-xs border-collapse">
                    <thead className="bg-slate-800 text-white">
                      <tr>
                        <th className="p-2.5 border-l border-slate-700">#</th>
                        <th className="p-2.5 border-l border-slate-700">الصنف</th>
                        <th className="p-2.5 border-l border-slate-700 text-center">الوحدة</th>
                        <th className="p-2.5 border-l border-slate-700 text-center">الكمية</th>
                        {!isDamaged && <th className="p-2.5 border-l border-slate-700 text-center">السعر</th>}
                        {isInvoice && <th className="p-2.5 border-l border-slate-700 text-center">الخصم</th>}
                        {!isDamaged && <th className="p-2.5 text-center">الإجمالي</th>}
                        {isDamaged && <th className="p-2.5 text-center">التكلفة / الخسارة</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {doc.items.map((it: any, idx: number) => (
                        <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          <td className="p-2 border-l border-slate-200 text-center text-slate-500 font-mono">{idx + 1}</td>
                          <td className="p-2 border-l border-slate-200 font-bold text-slate-800">{it.productName}</td>
                          <td className="p-2 border-l border-slate-200 text-center">{it.unit}</td>
                          <td className="p-2 border-l border-slate-200 text-center font-bold">{it.quantity}</td>
                          {!isDamaged && <td className="p-2 border-l border-slate-200 text-center font-mono">{Number(it.unitPrice || 0).toFixed(2)}</td>}
                          {isInvoice && <td className="p-2 border-l border-slate-200 text-center font-mono text-rose-600">{Number(it.discount || 0).toFixed(2)}</td>}
                          {!isDamaged && <td className="p-2 text-center font-mono font-bold text-slate-900">{Number(it.total || 0).toFixed(2)}</td>}
                          {isDamaged && <td className="p-2 text-center font-mono font-bold text-rose-700">{Number(it.totalLoss || 0).toFixed(2)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Financial Summary for Invoice/Return/Cash */}
              {(isInvoice || isReturn || data.docType === 'cash_tx') && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-emerald-50/60 border border-emerald-200 rounded-xl p-3.5 text-xs">
                  {doc.subtotal !== undefined && (
                    <div>
                      <span className="text-slate-600 block">الإجمالي الفرعي</span>
                      <strong className="font-mono text-slate-900">{Number(doc.subtotal || 0).toFixed(2)} {currency}</strong>
                    </div>
                  )}
                  {doc.discountTotal !== undefined && (
                    <div>
                      <span className="text-slate-600 block">الخصم</span>
                      <strong className="font-mono text-rose-700">{Number(doc.discountTotal || 0).toFixed(2)} {currency}</strong>
                    </div>
                  )}
                  <div>
                    <span className="text-slate-600 block">المبلغ الصافي</span>
                    <strong className="font-mono text-base text-emerald-800">{Number(doc.grandTotal ?? doc.amount ?? 0).toFixed(2)} {currency}</strong>
                  </div>
                  {doc.paidAmount !== undefined && (
                    <div>
                      <span className="text-slate-600 block">المدفوع / الآجل</span>
                      <strong className="font-mono text-slate-900">
                        {Number(doc.paidAmount || 0).toFixed(2)} / {Number(doc.remainingAmount || 0).toFixed(2)}
                      </strong>
                    </div>
                  )}
                </div>
              )}

              {/* Notes & Description */}
              {(doc.notes || doc.description || doc.reason) && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                  <strong className="text-slate-900">البيان والملاحظات: </strong>
                  <span>{doc.description || doc.reason || doc.notes}</span>
                  {doc.notes && doc.description && doc.notes !== doc.description && (
                    <p className="mt-1 text-slate-600">{doc.notes}</p>
                  )}
                </div>
              )}

              {/* Audit Trail for Edits & Cancellations */}
              {Array.isArray(data.auditTrail) && data.auditTrail.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-3.5 py-2 bg-slate-100 border-b border-slate-200 flex items-center gap-2 text-xs font-extrabold text-slate-700">
                    <History className="w-4 h-4 text-blue-600" />
                    <span>سجل التدقيق والتعديلات (Audit Trail)</span>
                  </div>
                  <div className="divide-y divide-slate-100 text-xs">
                    {data.auditTrail.map((log) => (
                      <div key={log.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-slate-900">{log.action}</span>
                          {log.notes && <span className="text-slate-500 mr-2">({log.notes})</span>}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {log.userName} · {String(log.timestamp || '').replace('T', ' ').slice(0, 16)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

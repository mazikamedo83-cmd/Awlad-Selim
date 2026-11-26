import React from 'react';
import { X, Printer, FileText, History, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { ReportSourceDocumentResponse } from '../../../types';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';

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
  const { t, dir } = usePreferences();
  if (!isOpen) return null;

  const doc = data?.document || {};
  const isInvoice = data?.docType === 'sales_invoice' || data?.docType === 'purchase_invoice';
  const isReturn = data?.docType === 'sales_return' || data?.docType === 'purchase_return';
  const isDamaged = data?.docType === 'damaged_voucher';
  const fmt2 = (v: unknown) => formatLocaleNumber(Number(v || 0), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-2" dir={dir}>
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-lg bg-white shadow-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 awlad-brand-gradient text-white">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#DCE6F5]" />
            <div>
              <h3 className="font-extrabold text-sm">
                {isLoading ? t('جاري تحميل المستند الأصلي...', 'Loading source document...') : (data?.title ? t(data.title) : t('تفاصيل المستند الأصلي', 'Source Document Details'))}
              </h3>
              {doc.actualDateTime && (
                <p className="text-[11px] text-[#DCE6F5] font-mono">{doc.actualDateTime}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {data && onPrint && (
              <button
                type="button"
                onClick={() => onPrint(data)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white text-[#011E58] hover:bg-[#EEF3FA] text-xs font-black cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{t('طباعة', 'Print')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-md text-[#DCE6F5] hover:text-white hover:bg-white/15 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {isLoading && (
            <div className="py-6 text-center text-slate-500 text-xs font-bold">{t('جاري استرجاع بيانات المستند من قاعدة البيانات...', 'Retrieving document data from database...')}</div>
          )}

          {error && (
            <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{t(error)}</span>
            </div>
          )}

          {!isLoading && !error && data && (
            <>
              {/* Status Badges */}
              {doc.status === 'cancelled' && (
                <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center justify-between">
                  <span>{t('مستند ملغى بواسطة:', 'Document cancelled by:')} {doc.cancelledBy || '-'} ({doc.cancelReason || t('بدون سبب مسجل', 'No recorded reason')})</span>
                  <span className="font-mono">{doc.cancelledAt ? String(doc.cancelledAt).split('T')[0] : ''}</span>
                </div>
              )}
              {doc.editedBy && (
                <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold flex items-center justify-between">
                  <span>{t('تم تعديل هذا المستند بواسطة:', 'Document edited by:')} {doc.editedBy}</span>
                  <span className="font-mono">{doc.editedAt ? String(doc.editedAt).split('T')[0] : ''}</span>
                </div>
              )}

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs">
                <div>
                  <span className="text-slate-500 block">{t('رقم المستند', 'Document #')}</span>
                  <strong className="font-mono text-slate-900">{doc.invoiceNumber || doc.returnNumber || doc.docNumber || doc.transactionNumber || doc.movementNumber || '-'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">{t('تاريخ اليومية', 'Journal Date')}</span>
                  <strong className="font-mono text-slate-900">{doc.date || '-'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">{t('الفرع / المستودع', 'Branch / Warehouse')}</span>
                  <strong className="text-slate-900">{doc.branchName || '-'}{doc.warehouseName ? ` — ${doc.warehouseName}` : ''}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">{t('الخزنة', 'Cashbox')}</span>
                  <strong className="text-slate-900">{doc.cashboxName || '-'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">{t('الطرف / الجهة', 'Party / Entity')}</span>
                  <strong className="text-slate-900">{doc.customerName || doc.supplierName || doc.partyName || doc.relatedEntityName || '-'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">{t('المندوب / الموظف', 'Rep / Employee')}</span>
                  <strong className="text-slate-900">{doc.representativeName || doc.createdBy || '-'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">{t('المستخدم المنشئ', 'Created By')}</span>
                  <strong className="text-slate-900">{doc.createdBy || '-'}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">{t('الحالة / نوع السداد', 'Status / Payment')}</span>
                  <strong className="text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {doc.status === 'cancelled'
                      ? t('ملغى', 'Cancelled')
                      : doc.paymentType === 'cash'
                      ? t('نقدي', 'Cash')
                      : doc.paymentType === 'partial'
                      ? t('سداد جزئي', 'Partial Payment')
                      : doc.paymentType === 'credit'
                      ? t('آجل', 'Credit')
                      : doc.refundType === 'cash'
                      ? t('رد نقدي', 'Cash Refund')
                      : doc.refundType === 'balance'
                      ? t('خصم من الرصيد', 'Deduct from Balance')
                      : t('معتمد', 'Approved')}
                  </strong>
                </div>
              </div>

              {/* Items Table for Invoices / Returns / Damaged */}
              {Array.isArray(doc.items) && doc.items.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-x-auto">
                  <table className="w-full text-start text-xs border-collapse">
                    <thead className="bg-slate-800 text-white">
                      <tr>
                        <th className="p-1.5 px-2 border-e border-slate-700">#</th>
                        <th className="p-1.5 px-2 border-e border-slate-700">{t('الصنف', 'Item')}</th>
                        <th className="p-1.5 px-2 border-e border-slate-700 text-center">{t('الوحدة', 'Unit')}</th>
                        <th className="p-1.5 px-2 border-e border-slate-700 text-center">{t('الكمية', 'Qty')}</th>
                        {!isDamaged && <th className="p-1.5 px-2 border-e border-slate-700 text-center">{t('السعر', 'Price')}</th>}
                        {isInvoice && <th className="p-1.5 px-2 border-e border-slate-700 text-center">{t('الخصم', 'Discount')}</th>}
                        {!isDamaged && <th className="p-1.5 px-2 text-center">{t('الإجمالي', 'Total')}</th>}
                        {isDamaged && <th className="p-1.5 px-2 text-center">{t('التكلفة / الخسارة', 'Cost / Loss')}</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {doc.items.map((it: any, idx: number) => (
                        <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          <td className="p-1.5 px-2 border-e border-slate-200 text-center text-slate-500 font-mono">{idx + 1}</td>
                          <td className="p-1.5 px-2 border-e border-slate-200 font-bold text-slate-800">{it.productName}</td>
                          <td className="p-1.5 px-2 border-e border-slate-200 text-center">{t(it.unit)}</td>
                          <td className="p-1.5 px-2 border-e border-slate-200 text-center font-bold">{formatLocaleNumber(it.quantity)}</td>
                          {!isDamaged && <td className="p-1.5 px-2 border-e border-slate-200 text-center font-mono">{fmt2(it.unitPrice)}</td>}
                          {isInvoice && <td className="p-1.5 px-2 border-e border-slate-200 text-center font-mono text-rose-600">{fmt2(it.discount)}</td>}
                          {!isDamaged && <td className="p-1.5 px-2 text-center font-mono font-bold text-slate-900">{fmt2(it.total)}</td>}
                          {isDamaged && <td className="p-1.5 px-2 text-center font-mono font-bold text-rose-700">{fmt2(it.totalLoss)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Financial Summary for Invoice/Return/Cash */}
              {(isInvoice || isReturn || data.docType === 'cash_tx') && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-[#EEF3FA] border border-[#DCE6F5] rounded-lg p-2 text-xs">
                  {doc.subtotal !== undefined && (
                    <div>
                      <span className="text-slate-600 block">{t('الإجمالي الفرعي', 'Subtotal')}</span>
                      <strong className="font-mono text-slate-900">{fmt2(doc.subtotal)} {t(currency)}</strong>
                    </div>
                  )}
                  {doc.discountTotal !== undefined && (
                    <div>
                      <span className="text-slate-600 block">{t('الخصم', 'Discount')}</span>
                      <strong className="font-mono text-rose-700">{fmt2(doc.discountTotal)} {t(currency)}</strong>
                    </div>
                  )}
                  <div>
                    <span className="text-slate-600 block">{t('المبلغ الصافي', 'Net Amount')}</span>
                    <strong className="font-mono text-sm text-[#011E58]">{fmt2(doc.grandTotal ?? doc.amount ?? 0)} {t(currency)}</strong>
                  </div>
                  {doc.paidAmount !== undefined && (
                    <div>
                      <span className="text-slate-600 block">{t('المدفوع / الآجل', 'Paid / Credit')}</span>
                      <strong className="font-mono text-slate-900">
                        {fmt2(doc.paidAmount)} / {fmt2(doc.remainingAmount)}
                      </strong>
                    </div>
                  )}
                </div>
              )}

              {/* Notes & Description */}
              {(doc.notes || doc.description || doc.reason) && (
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                  <strong className="text-slate-900">{t('البيان والملاحظات:', 'Notes & Description:')} </strong>
                  <span>{doc.description || doc.reason || doc.notes}</span>
                  {doc.notes && doc.description && doc.notes !== doc.description && (
                    <p className="mt-1 text-slate-600">{doc.notes}</p>
                  )}
                </div>
              )}

              {/* Audit Trail for Edits & Cancellations */}
              {Array.isArray(data.auditTrail) && data.auditTrail.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="px-2.5 py-1.5 bg-slate-100 border-b border-slate-200 flex items-center gap-1.5 text-xs font-extrabold text-slate-700">
                    <History className="w-3.5 h-3.5 text-blue-600" />
                    <span>{t('سجل التدقيق والتعديلات (Audit Trail)', 'Audit Trail & Edits Log')}</span>
                  </div>
                  <div className="divide-y divide-slate-100 text-xs">
                    {data.auditTrail.map((log) => (
                      <div key={log.id} className="px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-bold text-slate-900">{t(log.action)}</span>
                          {log.notes && <span className="text-slate-500 ms-2">({log.notes})</span>}
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

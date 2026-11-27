import React, { useEffect, useState } from 'react';
import { FileText, AlertCircle, Printer, Loader2 } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { usePreferences } from '../../context/PreferencesContext';
import { formatLocaleNumber } from '../../i18n/translator';
import { Modal } from './Modal';
import { PrintDocumentModal, PrintData } from './PrintDocument';

export interface OriginalSourceDocumentTarget {
  docType: string;
  docId: string;
  docNumber?: string;
}

interface OriginalSourceDocumentModalProps {
  target: OriginalSourceDocumentTarget | null;
  onClose: () => void;
}

export const OriginalSourceDocumentModal: React.FC<OriginalSourceDocumentModalProps> = ({
  target,
  onClose,
}) => {
  const { getSyncSourceDocument, settings } = useData();
  const { t, isRtl } = usePreferences();
  const fmt = (n: number) => formatLocaleNumber(Number(n || 0));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedDoc, setLoadedDoc] = useState<any>(null);
  const [resolvedType, setResolvedType] = useState<string>('');
  const [printData, setPrintData] = useState<PrintData | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!target) {
      setLoadedDoc(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    getSyncSourceDocument(target.docType, target.docId)
      .then((res) => {
        if (cancelled) return;
        if (!res || !res.document) {
          setError(t('تعذر العثور على المستند الأصلي أو قد لا تملك صلاحية عرضه.', 'Could not locate original document or insufficient permission.'));
          setLoadedDoc(null);
        } else {
          setLoadedDoc(res.document);
          setResolvedType((res as any).docType || target.docType);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(t('حدث خطأ أثناء فتح المستند الأصلي.', 'Failed to open original document.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target?.docType, target?.docId]);

  const docNum =
    loadedDoc?.requestNumber ||
    loadedDoc?.transferNumber ||
    loadedDoc?.invoiceNumber ||
    loadedDoc?.returnNumber ||
    loadedDoc?.batchNumber ||
    target?.docNumber ||
    target?.docId ||
    '';

  const getTitleLabel = () => {
    const dt = resolvedType || target?.docType || '';
    if (dt === 'rep_item_transfer') return t('أمر تحويل', 'Transfer Order');
    if (dt === 'custody_return_request' || dt === 'rep_custody_return_request') {
      return t('طلب إرجاع بضاعة من المندوب', 'Rep Custody Return Request');
    }
    if (dt === 'stock_transfer_request') return t('أمر تحويل مخزني', 'Warehouse Stock Transfer');
    if (dt === 'rep_transfer') return t('سند تحويل نقدي', 'Cash Transfer Document');
    if (dt === 'dispatch_batch' || dt === 'sync_dispatch_batch') return t('دفعة إرسال مستندات', 'Document Dispatch Batch');
    if (dt === 'sales_invoice' || dt === 'purchase_invoice' || dt === 'invoice') return t('الفاتورة الأصلية', 'Original Invoice');
    return t('المستند الأصلي', 'Original Document');
  };

  const handlePrint = () => {
    if (!loadedDoc) return;
    const rawItems = Array.isArray(loadedDoc.items) ? loadedDoc.items : [];
    setPrintData({
      title: `${getTitleLabel()} (${docNum})`,
      docNumber: docNum,
      docType: t('مستند مرجعي أصلي', 'Original Reference Document'),
      date: loadedDoc.date || String(loadedDoc.createdAt || '').slice(0, 10),
      partyName:
        loadedDoc.representativeName ||
        loadedDoc.customerName ||
        loadedDoc.supplierName ||
        loadedDoc.receiverName ||
        '-',
      warehouseName: loadedDoc.sourceWarehouseName || loadedDoc.warehouseName || loadedDoc.vanWarehouseName || '',
      items: rawItems.map((it: any) => ({
        name: it.productName || '-',
        unit: it.unit ? t(it.unit) : '-',
        quantity: Number(it.quantity ?? it.approvedQty ?? it.requestedQty ?? 0),
        price: Number(it.unitPrice || 0),
        total: Number(it.total ?? it.approvedQty ?? it.requestedQty ?? it.quantity ?? 0),
      })),
      grandTotal: Number(
        loadedDoc.grandTotal ??
          loadedDoc.amount ??
          rawItems.reduce((s: number, it: any) => s + Number(it.quantity ?? it.approvedQty ?? it.requestedQty ?? 0), 0)
      ),
      notes: loadedDoc.notes || loadedDoc.reviewNotes || loadedDoc.confirmationNotes || '',
    });
  };

  const dt = resolvedType || target?.docType || '';
  const itemsList: any[] = Array.isArray(loadedDoc?.items) ? loadedDoc.items : [];

  return (
    <>
      <Modal
        isOpen={Boolean(target)}
        onClose={onClose}
        title={`${getTitleLabel()} ${docNum ? `(${docNum})` : ''}`}
        subtitle={t('عرض مرجعي للمستند الأصلي دون إنشاء نسخة أو تكرار أثر مخزني أو محاسبي', 'Read-only original document view — zero duplicate invoice or ledger impact')}
        maxWidth="3xl"
      >
        <div className="space-y-3 text-xs">
          {loading ? (
            <div className="py-10 flex flex-col items-center justify-center gap-2 text-slate-500">
              <Loader2 className="w-6 h-6 animate-spin text-[#003589]" />
              <span className="font-bold">{t('جاري تحميل المستند الأصلي...', 'Loading original document...')}</span>
            </div>
          ) : error ? (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : loadedDoc ? (
            <>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0A162B] border border-slate-200 dark:border-[#21375C] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                <div>
                  <span className="text-slate-500">{t('رقم المستند:', 'Document #:')}</span>{' '}
                  <strong className="font-mono text-[#011E58] dark:text-[#7FB2FF]">{docNum}</strong>
                </div>
                <div>
                  <span className="text-slate-500">{t('التاريخ:', 'Date:')}</span>{' '}
                  <strong className="font-mono">{loadedDoc.date || String(loadedDoc.createdAt || '').slice(0, 10)}</strong>
                </div>
                <div>
                  <span className="text-slate-500">{t('الحالة:', 'Status:')}</span>{' '}
                  <strong className="px-1.5 py-0.5 rounded bg-blue-100 text-[#011E58] text-[11px]">
                    {t(loadedDoc.status || '-')}
                  </strong>
                </div>
                {loadedDoc.representativeName && (
                  <div>
                    <span className="text-slate-500">{t('المندوب:', 'Representative:')}</span>{' '}
                    <strong>{loadedDoc.representativeName}</strong>
                  </div>
                )}
                {(loadedDoc.customerName || loadedDoc.supplierName) && (
                  <div>
                    <span className="text-slate-500">{t('الطرف:', 'Party:')}</span>{' '}
                    <strong>{loadedDoc.customerName || loadedDoc.supplierName}</strong>
                  </div>
                )}
                {loadedDoc.sourceWarehouseName && (
                  <div>
                    <span className="text-slate-500">{t('من مخزن:', 'From:')}</span>{' '}
                    <strong>{t(loadedDoc.sourceWarehouseName)}</strong>
                  </div>
                )}
                {(loadedDoc.targetWarehouseName || loadedDoc.vanWarehouseName) && (
                  <div>
                    <span className="text-slate-500">{t('إلى مخزن:', 'To:')}</span>{' '}
                    <strong>{t(loadedDoc.targetWarehouseName || loadedDoc.vanWarehouseName)}</strong>
                  </div>
                )}
                {loadedDoc.senderName && (
                  <div>
                    <span className="text-slate-500">{t('المرسل:', 'Sender:')}</span>{' '}
                    <strong>{loadedDoc.senderName}</strong>
                  </div>
                )}
                {loadedDoc.receiverName && (
                  <div>
                    <span className="text-slate-500">{t('المستلم:', 'Receiver:')}</span>{' '}
                    <strong>{loadedDoc.receiverName}</strong>
                  </div>
                )}
                {(loadedDoc.sentAt || loadedDoc.dispatchedAt) && (
                  <div>
                    <span className="text-slate-500">{t('تاريخ ووقت الإرسال:', 'Sent At:')}</span>{' '}
                    <strong className="font-mono">{new Date(loadedDoc.sentAt || loadedDoc.dispatchedAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US')}</strong>
                  </div>
                )}
                {(loadedDoc.receivedAt || loadedDoc.confirmedAt || loadedDoc.approvedAt) && (
                  <div>
                    <span className="text-slate-500">{t('تاريخ الاستلام/الاعتماد:', 'Confirmed/Approved At:')}</span>{' '}
                    <strong className="font-mono">{new Date(loadedDoc.receivedAt || loadedDoc.confirmedAt || loadedDoc.approvedAt).toLocaleString(isRtl ? 'ar-EG' : 'en-US')}</strong>
                  </div>
                )}
                {(loadedDoc.receivedBy || loadedDoc.reviewedByName || loadedDoc.confirmedBy) && (
                  <div>
                    <span className="text-slate-500">{t('المؤكد/المراجع:', 'Confirmed By:')}</span>{' '}
                    <strong>{loadedDoc.receivedBy || loadedDoc.reviewedByName || loadedDoc.confirmedBy}</strong>
                  </div>
                )}
              </div>

              {loadedDoc.amount !== undefined && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between">
                  <span className="font-bold text-emerald-900">{t('المبلغ:', 'Amount:')}</span>
                  <span className="font-mono text-sm font-black text-emerald-800">
                    {fmt(loadedDoc.amount)} {t(settings.currency)}
                  </span>
                </div>
              )}

              {itemsList.length > 0 && (
                <div className="rounded-lg border border-slate-200 dark:border-[#21375C] overflow-hidden">
                  <table className="w-full text-start border-collapse">
                    <thead className="bg-slate-100 dark:bg-[#132544] text-slate-700 dark:text-[#DCE6F5] text-[11px]">
                      <tr>
                        <th className="p-2 text-start">#</th>
                        <th className="p-2 text-start">{t('الصنف', 'Item')}</th>
                        <th className="p-2 text-center">{t('الوحدة', 'Unit')}</th>
                        {(dt === 'custody_return_request' || dt === 'rep_custody_return_request') ? (
                          <>
                            <th className="p-2 text-center">{t('المطلوبة', 'Requested')}</th>
                            <th className="p-2 text-center">{t('المستلمة فعلياً', 'Actual Received')}</th>
                            <th className="p-2 text-center">{t('المعتمدة', 'Approved')}</th>
                            <th className="p-2 text-center">{t('المتبقي على المندوب', 'Remaining Custody')}</th>
                          </>
                        ) : (
                          <>
                            <th className="p-2 text-center">{t('الكمية', 'Quantity')}</th>
                            {itemsList[0]?.unitPrice !== undefined && (
                              <th className="p-2 text-center">{t('السعر', 'Price')}</th>
                            )}
                            {itemsList[0]?.total !== undefined && (
                              <th className="p-2 text-center">{t('الإجمالي', 'Total')}</th>
                            )}
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-[#1B2F52]">
                      {itemsList.map((it, idx) => (
                        <tr key={`${it.productId || idx}-${idx}`}>
                          <td className="p-2 font-mono text-slate-500">{fmt(idx + 1)}</td>
                          <td className="p-2 font-bold text-slate-900 dark:text-[#F3F7FC]">{it.productName || '-'}</td>
                          <td className="p-2 text-center">{it.unit ? t(it.unit) : '-'}</td>
                          {(dt === 'custody_return_request' || dt === 'rep_custody_return_request') ? (
                            <>
                              <td className="p-2 text-center font-mono font-bold">{fmt(it.requestedQty)}</td>
                              <td className="p-2 text-center font-mono text-blue-800 dark:text-blue-300">
                                {it.actualReceivedQty !== undefined ? fmt(it.actualReceivedQty) : '-'}
                              </td>
                              <td className="p-2 text-center font-mono font-bold text-emerald-700 dark:text-emerald-300">
                                {it.approvedQty !== undefined ? fmt(it.approvedQty) : '-'}
                              </td>
                              <td className="p-2 text-center font-mono font-bold text-amber-700 dark:text-amber-300">
                                {it.remainingCustodyQty !== undefined ? fmt(it.remainingCustodyQty) : '-'}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="p-2 text-center font-mono font-black text-[#011E58] dark:text-[#7FB2FF]">
                                {fmt(it.quantity ?? it.approvedQty ?? it.requestedQty ?? 0)}
                              </td>
                              {itemsList[0]?.unitPrice !== undefined && (
                                <td className="p-2 text-center font-mono">{fmt(it.unitPrice || 0)}</td>
                              )}
                              {itemsList[0]?.total !== undefined && (
                                <td className="p-2 text-center font-mono font-bold">{fmt(it.total || 0)}</td>
                              )}
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(loadedDoc.notes || loadedDoc.confirmationNotes || loadedDoc.reviewNotes || loadedDoc.rejectionReason) && (
                <div className="p-2.5 rounded-lg bg-blue-50/70 dark:bg-[#132544] border border-blue-200/70 dark:border-[#21375C] space-y-1">
                  {loadedDoc.notes && (
                    <div>
                      <span className="font-bold">{t('ملاحظات المستند:', 'Notes:')}</span> {loadedDoc.notes}
                    </div>
                  )}
                  {loadedDoc.confirmationNotes && (
                    <div>
                      <span className="font-bold text-emerald-800 dark:text-emerald-300">{t('تفاصيل تأكيد الاستلام:', 'Confirmation Details:')}</span>{' '}
                      {loadedDoc.confirmationNotes}
                    </div>
                  )}
                  {loadedDoc.reviewNotes && (
                    <div>
                      <span className="font-bold text-blue-900 dark:text-blue-300">{t('ملاحظات المراجعة:', 'Review Notes:')}</span>{' '}
                      {loadedDoc.reviewNotes}
                    </div>
                  )}
                  {loadedDoc.rejectionReason && (
                    <div className="text-rose-700 dark:text-rose-300 font-bold">
                      {t('سبب الرفض:', 'Rejection Reason:')} {loadedDoc.rejectionReason}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="flex items-center gap-1 h-8 px-3 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{t('طباعة', 'Print')}</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="h-8 px-3 rounded-md border border-slate-300 font-bold cursor-pointer"
                >
                  {t('إغلاق', 'Close')}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </Modal>
      <PrintDocumentModal isOpen={Boolean(printData)} onClose={() => setPrintData(null)} data={printData} />
    </>
  );
};

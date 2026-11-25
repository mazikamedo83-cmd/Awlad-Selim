import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Info,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import {
  clearDiagnostics,
  DiagnosticCategory,
  DiagnosticLogEntry,
  DiagnosticSeverity,
  formatDiagnosticsExport,
  getDiagnostics,
  subscribeDiagnostics,
} from '../../../services/diagnostics';
import { saveAndShareDocument } from '../../../services/native';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';

const CATEGORY_LABELS: Record<DiagnosticCategory, string> = {
  app_event: 'أحداث التطبيق',
  network_error: 'أخطاء الشبكة والسيرفر',
  sync_issue: 'مشاكل المزامنة',
  auth: 'المصادقة والأجهزة',
};

const SEVERITY_META: Record<
  DiagnosticSeverity,
  { label: string; icon: React.ElementType; badgeCls: string }
> = {
  error: {
    label: 'خطأ',
    icon: AlertCircle,
    badgeCls: 'bg-rose-50 text-rose-800 border-rose-200',
  },
  warning: {
    label: 'تحذير',
    icon: AlertTriangle,
    badgeCls: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  info: {
    label: 'معلومة',
    icon: Info,
    badgeCls: 'bg-sky-50 text-sky-800 border-sky-200',
  },
};

function formatDateTimeAr(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const DiagnosticLogsPanel: React.FC = () => {
  const [entries, setEntries] = useState<DiagnosticLogEntry[]>(() => getDiagnostics());
  const [categoryFilter, setCategoryFilter] = useState<'all' | DiagnosticCategory>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | DiagnosticSeverity>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  useEffect(() => {
    setEntries(getDiagnostics());
    return subscribeDiagnostics(() => {
      setEntries(getDiagnostics());
    });
  }, []);

  const stats = useMemo(() => {
    return {
      total: entries.length,
      networkErrors: entries.filter((e) => e.category === 'network_error').length,
      syncIssues: entries.filter((e) => e.category === 'sync_issue').length,
      authEvents: entries.filter((e) => e.category === 'auth').length,
      errorCount: entries.filter((e) => e.severity === 'error').length,
    };
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return entries.filter((entry) => {
      if (categoryFilter !== 'all' && entry.category !== categoryFilter) return false;
      if (severityFilter !== 'all' && entry.severity !== severityFilter) return false;
      if (!q) return true;
      const detailsText = entry.details ? JSON.stringify(entry.details).toLowerCase() : '';
      return (
        entry.message.toLowerCase().includes(q) ||
        entry.source.toLowerCase().includes(q) ||
        CATEGORY_LABELS[entry.category].toLowerCase().includes(q) ||
        detailsText.includes(q)
      );
    });
  }, [entries, categoryFilter, severityFilter, searchTerm]);

  const handleCopyExport = async () => {
    try {
      const payload = formatDiagnosticsExport();
      await navigator.clipboard.writeText(payload);
      setCopiedNotice(true);
      setActionNotice('تم نسخ سجل التشخيص بصيغة JSON (بعد تنقية البيانات الحساسة).');
      window.setTimeout(() => setCopiedNotice(false), 2500);
    } catch {
      setActionNotice('تعذر النسخ التلقائي إلى الحافظة.');
    }
  };

  const handleDownloadExport = async () => {
    const payload = formatDiagnosticsExport();
    const res = await saveAndShareDocument({
      filename: `awlad-selim-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      content: payload,
      mimeType: 'application/json;charset=utf-8',
      title: 'تصدير سجل التشخيص والأخطاء — أولاد سليم',
    });
    if (!res.ok) {
      setActionNotice(res.error || 'تعذر تصدير ملف التشخيص.');
    }
  };

  return (
    <div className="space-y-2.5 text-xs">
      {/* Header & Summary */}
      <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-2">
          <div className="space-y-0.5">
            <h3 className="text-xs sm:text-sm font-black text-slate-900 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-rose-700" />
              <span>سجل التشخيص والأخطاء (Diagnostics)</span>
            </h3>
            <p className="text-[11px] text-slate-500">
              يعرض أحدث أحداث التطبيق، أخطاء الاتصال بالخادم، ومشاكل المزامنة على هذا الجهاز لتسهيل الدعم الفني (يتم إخفاء التوكنات وكلمات المرور تلقائياً).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setEntries(getDiagnostics())}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>تحديث</span>
            </button>
            <button
              type="button"
              onClick={handleCopyExport}
              disabled={entries.length === 0}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold cursor-pointer disabled:opacity-50"
            >
              {copiedNotice ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
              <span>نسخ JSON</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadExport}
              disabled={entries.length === 0}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-900 font-bold cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير</span>
            </button>
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              disabled={entries.length === 0}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 font-bold cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>مسح السجل</span>
            </button>
          </div>
        </div>

        {/* 4 Summary Tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-50/70 px-2.5 py-2">
            <span className="text-[10px] font-bold text-slate-500 block">إجمالي الأحداث المسجلة</span>
            <strong className="text-sm font-black font-mono tabular-nums text-slate-900">{stats.total}</strong>
          </div>
          <div className="bg-rose-50/60 px-2.5 py-2">
            <span className="text-[10px] font-bold text-rose-700 block">أخطاء الشبكة والسيرفر</span>
            <strong className="text-sm font-black font-mono tabular-nums text-rose-900">{stats.networkErrors}</strong>
          </div>
          <div className="bg-amber-50/60 px-2.5 py-2">
            <span className="text-[10px] font-bold text-amber-800 block">مشاكل وتعذر المزامنة</span>
            <strong className="text-sm font-black font-mono tabular-nums text-amber-900">{stats.syncIssues}</strong>
          </div>
          <div className="bg-slate-50/70 px-2.5 py-2">
            <span className="text-[10px] font-bold text-slate-600 block">أحداث المصادقة والأجهزة</span>
            <strong className="text-sm font-black font-mono tabular-nums text-slate-900">{stats.authEvents}</strong>
          </div>
        </div>

        {actionNotice && (
          <div className="px-2.5 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-blue-900 font-bold flex items-center justify-between gap-2">
            <span>{actionNotice}</span>
            <button type="button" onClick={() => setActionNotice(null)} className="underline cursor-pointer">
              إغلاق
            </button>
          </div>
        )}

        {/* Filter Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="relative">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="بحث في الرسالة أو المصدر أو التفاصيل..."
              className="w-full h-8 rounded-md border border-slate-300 bg-slate-50 pr-8 pl-2.5 font-semibold focus:bg-white focus:border-blue-600 outline-hidden"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5" />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | DiagnosticCategory)}
            className="h-8 rounded-md border border-slate-300 bg-slate-50 px-2.5 font-bold text-slate-700 focus:bg-white focus:border-blue-600 outline-hidden"
          >
            <option value="all">-- جميع التصنيفات --</option>
            <option value="network_error">أخطاء الشبكة والسيرفر</option>
            <option value="sync_issue">مشاكل المزامنة</option>
            <option value="auth">المصادقة والأجهزة</option>
            <option value="app_event">أحداث التطبيق</option>
          </select>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as 'all' | DiagnosticSeverity)}
            className="h-8 rounded-md border border-slate-300 bg-slate-50 px-2.5 font-bold text-slate-700 focus:bg-white focus:border-blue-600 outline-hidden"
          >
            <option value="all">-- جميع المستويات --</option>
            <option value="error">خطأ (Error)</option>
            <option value="warning">تحذير (Warning)</option>
            <option value="info">معلومة (Info)</option>
          </select>
        </div>
      </div>

      {/* Entries Unified Table */}
      <UnifiedDataTable<DiagnosticLogEntry>
        data={filteredEntries}
        rowKey={(e) => e.id}
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
        searchable={false}
        compact
        exportFilename="سجل-التشخيص-والأخطاء"
        pdfTitle="سجل التشخيص والأخطاء"
        emptyTitle="لا توجد سجلات تشخيص مطابقة"
        emptySubtitle="تُسجَّل هنا أحداث الشبكة والمزامنة وأحداث النظام الفعلية عند حدوثها على هذا الجهاز."
        columns={[
          {
            key: 'severity',
            header: 'المستوى',
            align: 'center',
            sortValue: (e) => e.severity,
            exportValue: (e) => SEVERITY_META[e.severity].label,
            render: (e) => {
              const sev = SEVERITY_META[e.severity];
              const SevIcon = sev.icon;
              return (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-bold ${sev.badgeCls}`}>
                  <SevIcon className="w-3.5 h-3.5" />
                  <span>{sev.label}</span>
                </span>
              );
            },
          },
          {
            key: 'category',
            header: 'التصنيف',
            align: 'center',
            sortValue: (e) => e.category,
            exportValue: (e) => CATEGORY_LABELS[e.category],
            render: (e) => <span className="font-bold text-slate-700">{CATEGORY_LABELS[e.category]}</span>,
          },
          {
            key: 'message',
            header: 'الحدث / الرسالة',
            align: 'right',
            sortValue: (e) => e.message,
            exportValue: (e) => e.message,
            render: (e) => (
              <div>
                <div className="font-bold text-slate-900">{e.message}</div>
                {expandedId === e.id && e.details && (
                  <pre className="mt-2 rounded-lg bg-slate-950 text-slate-100 p-2 text-[11px] font-mono overflow-x-auto" dir="ltr">
                    {JSON.stringify(e.details, null, 2)}
                  </pre>
                )}
              </div>
            ),
          },
          {
            key: 'source',
            header: 'المصدر',
            align: 'left',
            sortValue: (e) => e.source,
            exportValue: (e) => e.source,
            render: (e) => <span className="font-mono text-[11px] text-slate-600" dir="ltr">{e.source}</span>,
          },
          {
            key: 'timestamp',
            header: 'الوقت',
            align: 'center',
            sortValue: (e) => e.timestamp,
            exportValue: (e) => formatDateTimeAr(e.timestamp),
            render: (e) => (
              <span className="font-mono tabular-nums text-[11px] text-slate-600" dir="ltr">
                {formatDateTimeAr(e.timestamp)}
              </span>
            ),
          },
          {
            key: 'actions',
            header: 'التفاصيل',
            align: 'center',
            sortable: false,
            render: (e) =>
              e.details ? (
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-bold text-[11px] cursor-pointer"
                >
                  <span>{expandedId === e.id ? 'إخفاء' : 'التفاصيل'}</span>
                </button>
              ) : (
                <span className="text-slate-400">—</span>
              ),
          },
        ]}
      />

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          clearDiagnostics();
          setShowClearConfirm(false);
          setActionNotice('تم مسح سجل التشخيص من هذا الجهاز.');
        }}
        title="مسح سجل التشخيص"
        message="هل تريد مسح جميع أحداث التشخيص وأخطاء الشبكة المسجلة محلياً على هذا الجهاز؟"
        confirmLabel="مسح السجل"
        variant="danger"
      />
    </div>
  );
};

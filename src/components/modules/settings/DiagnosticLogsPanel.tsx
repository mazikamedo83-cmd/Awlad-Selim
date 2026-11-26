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
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDateTime } from '../../../i18n/translator';
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

export const DiagnosticLogsPanel: React.FC = () => {
  const { dir, t } = usePreferences();
  const [entries, setEntries] = useState<DiagnosticLogEntry[]>(() => getDiagnostics());
  const [categoryFilter, setCategoryFilter] = useState<'all' | DiagnosticCategory>('all');
  const [severityFilter, setSeverityFilter] = useState<'all' | DiagnosticSeverity>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const categoryLabels: Record<DiagnosticCategory, string> = useMemo(
    () => ({
      app_event: t('أحداث التطبيق', 'App Events'),
      network_error: t('أخطاء الشبكة والسيرفر', 'Network & Server Errors'),
      sync_issue: t('مشاكل المزامنة', 'Sync Issues'),
      auth: t('المصادقة والأجهزة', 'Auth & Devices'),
    }),
    [t]
  );

  const severityMeta: Record<
    DiagnosticSeverity,
    { label: string; icon: React.ElementType; badgeCls: string }
  > = useMemo(
    () => ({
      error: {
        label: t('خطأ', 'Error'),
        icon: AlertCircle,
        badgeCls: 'bg-rose-50 text-rose-800 border-rose-200',
      },
      warning: {
        label: t('تحذير', 'Warning'),
        icon: AlertTriangle,
        badgeCls: 'bg-amber-50 text-amber-800 border-amber-200',
      },
      info: {
        label: t('معلومة', 'Info'),
        icon: Info,
        badgeCls: 'bg-[#EEF3FA] text-[#011E58] border-[#DCE6F5]',
      },
    }),
    [t]
  );

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
        categoryLabels[entry.category].toLowerCase().includes(q) ||
        detailsText.includes(q)
      );
    });
  }, [entries, categoryFilter, severityFilter, searchTerm, categoryLabels]);

  const handleCopyExport = async () => {
    try {
      const payload = formatDiagnosticsExport();
      await navigator.clipboard.writeText(payload);
      setCopiedNotice(true);
      setActionNotice(t('تم نسخ سجل التشخيص بصيغة JSON (بعد تنقية البيانات الحساسة).', 'Diagnostic logs copied as sanitized JSON.'));
      window.setTimeout(() => setCopiedNotice(false), 2500);
    } catch {
      setActionNotice(t('تعذر النسخ التلقائي إلى الحافظة.', 'Automatic clipboard copy failed.'));
    }
  };

  const handleDownloadExport = async () => {
    const payload = formatDiagnosticsExport();
    const res = await saveAndShareDocument({
      filename: `awlad-selim-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      content: payload,
      mimeType: 'application/json;charset=utf-8',
      title: t('تصدير سجل التشخيص والأخطاء — أولاد سليم', 'Export Diagnostic Logs — Awlad Selim'),
    });
    if (!res.ok) {
      setActionNotice(res.error ? t(res.error) : t('تعذر تصدير ملف التشخيص.', 'Could not export diagnostic file.'));
    }
  };

  const formatEntryTime = (iso: string) =>
    formatLocaleDateTime(iso, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  return (
    <div dir={dir} className="space-y-2.5 text-xs">
      {/* Header & Summary */}
      <div className="bg-white dark:bg-[#0E1C36] p-2.5 sm:p-3 rounded-lg border border-slate-200 dark:border-[#21375C] space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-[#21375C] pb-2">
          <div className="space-y-0.5">
            <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-[#F3F7FC] flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-rose-700" />
              <span>{t('سجل التشخيص والأخطاء (Diagnostics)', 'Diagnostics & Error Logs')}</span>
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-[#97AECE]">
              {t(
                'يعرض أحدث أحداث التطبيق، أخطاء الاتصال بالخادم، ومشاكل المزامنة على هذا الجهاز لتسهيل الدعم الفني (يتم إخفاء التوكنات وكلمات المرور تلقائياً).',
                'Shows recent app events, server connection errors, and sync issues on this device for support (tokens and passwords are automatically redacted).'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setEntries(getDiagnostics())}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] hover:bg-slate-50 text-slate-700 dark:text-[#DCE6F5] font-bold cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t('تحديث', 'Refresh')}</span>
            </button>
            <button
              type="button"
              onClick={handleCopyExport}
              disabled={entries.length === 0}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] hover:bg-slate-50 text-slate-700 dark:text-[#DCE6F5] font-bold cursor-pointer disabled:opacity-50"
            >
              {copiedNotice ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{t('نسخ JSON', 'Copy JSON')}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadExport}
              disabled={entries.length === 0}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-900 font-bold cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t('تصدير', 'Export')}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              disabled={entries.length === 0}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 font-bold cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('مسح السجل', 'Clear Log')}</span>
            </button>
          </div>
        </div>

        {/* 4 Summary Tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-50/70 px-2.5 py-2">
            <span className="text-[10px] font-bold text-slate-500 block">{t('إجمالي الأحداث المسجلة', 'Total Recorded Events')}</span>
            <strong className="text-sm font-black font-mono tabular-nums text-slate-900">{stats.total}</strong>
          </div>
          <div className="bg-rose-50/60 px-2.5 py-2">
            <span className="text-[10px] font-bold text-rose-700 block">{t('أخطاء الشبكة والسيرفر', 'Network & Server Errors')}</span>
            <strong className="text-sm font-black font-mono tabular-nums text-rose-900">{stats.networkErrors}</strong>
          </div>
          <div className="bg-amber-50/60 px-2.5 py-2">
            <span className="text-[10px] font-bold text-amber-800 block">{t('مشاكل وتعذر المزامنة', 'Sync Issues')}</span>
            <strong className="text-sm font-black font-mono tabular-nums text-amber-900">{stats.syncIssues}</strong>
          </div>
          <div className="bg-slate-50/70 px-2.5 py-2">
            <span className="text-[10px] font-bold text-slate-600 block">{t('أحداث المصادقة والأجهزة', 'Auth & Device Events')}</span>
            <strong className="text-sm font-black font-mono tabular-nums text-slate-900">{stats.authEvents}</strong>
          </div>
        </div>

        {actionNotice && (
          <div className="px-2.5 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-blue-900 font-bold flex items-center justify-between gap-2">
            <span>{actionNotice}</span>
            <button type="button" onClick={() => setActionNotice(null)} className="underline cursor-pointer">
              {t('إغلاق', 'Close')}
            </button>
          </div>
        )}

        {/* Filter Bar */}
        <div className="awlad-filter-row" data-testid="diag-filter-row">
          <div className="relative flex-1 min-w-[175px] shrink-0">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('بحث في الرسالة أو المصدر أو التفاصيل...', 'Search message, source or details...')}
              className="w-full h-8 rounded-md border border-slate-300 bg-slate-50 ps-8 pe-2.5 text-xs font-semibold focus:bg-white focus:border-blue-600 outline-hidden"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute start-2.5 top-2.5 pointer-events-none" />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | DiagnosticCategory)}
            className="h-8 shrink-0 rounded-md border border-slate-300 bg-slate-50 px-2.5 text-xs font-bold text-slate-700 focus:bg-white focus:border-blue-600 outline-hidden"
          >
            <option value="all">{t('جميع التصنيفات', 'All Categories')}</option>
            <option value="network_error">{t('أخطاء الشبكة والسيرفر', 'Network & Server Errors')}</option>
            <option value="sync_issue">{t('مشاكل المزامنة', 'Sync Issues')}</option>
            <option value="auth">{t('المصادقة والأجهزة', 'Auth & Devices')}</option>
            <option value="app_event">{t('أحداث التطبيق', 'App Events')}</option>
          </select>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as 'all' | DiagnosticSeverity)}
            className="h-8 shrink-0 rounded-md border border-slate-300 bg-slate-50 px-2.5 text-xs font-bold text-slate-700 focus:bg-white focus:border-blue-600 outline-hidden"
          >
            <option value="all">{t('جميع المستويات', 'All Severities')}</option>
            <option value="error">{t('خطأ (Error)', 'Error')}</option>
            <option value="warning">{t('تحذير (Warning)', 'Warning')}</option>
            <option value="info">{t('معلومة (Info)', 'Info')}</option>
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
        exportFilename={t('سجل-التشخيص-والأخطاء', 'diagnostics-logs')}
        pdfTitle={t('سجل التشخيص والأخطاء', 'Diagnostics & Error Logs')}
        emptyTitle={t('لا توجد سجلات تشخيص مطابقة', 'No matching diagnostic logs')}
        emptySubtitle={t(
          'تُسجَّل هنا أحداث الشبكة والمزامنة وأحداث النظام الفعلية عند حدوثها على هذا الجهاز.',
          'Network, sync, and system events recorded on this device will appear here.'
        )}
        columns={[
          {
            key: 'severity',
            header: t('المستوى', 'Severity'),
            align: 'center',
            sortValue: (e) => e.severity,
            exportValue: (e) => severityMeta[e.severity].label,
            render: (e) => {
              const sev = severityMeta[e.severity];
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
            header: t('التصنيف', 'Category'),
            align: 'center',
            sortValue: (e) => e.category,
            exportValue: (e) => categoryLabels[e.category],
            render: (e) => <span className="font-bold text-slate-700">{categoryLabels[e.category]}</span>,
          },
          {
            key: 'message',
            header: t('الحدث / الرسالة', 'Event / Message'),
            align: 'right',
            sortValue: (e) => e.message,
            exportValue: (e) => e.message,
            render: (e) => (
              <div>
                <div className="font-bold text-slate-900">{t(e.message)}</div>
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
            header: t('المصدر', 'Source'),
            align: 'left',
            sortValue: (e) => e.source,
            exportValue: (e) => e.source,
            render: (e) => <span className="font-mono text-[11px] text-slate-600" dir="ltr">{e.source}</span>,
          },
          {
            key: 'timestamp',
            header: t('الوقت', 'Timestamp'),
            align: 'center',
            sortValue: (e) => e.timestamp,
            exportValue: (e) => formatEntryTime(e.timestamp),
            render: (e) => (
              <span className="font-mono tabular-nums text-[11px] text-slate-600" dir="ltr">
                {formatEntryTime(e.timestamp)}
              </span>
            ),
          },
          {
            key: 'actions',
            header: t('التفاصيل', 'Details'),
            align: 'center',
            sortable: false,
            render: (e) =>
              e.details ? (
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-bold text-[11px] cursor-pointer"
                >
                  <span>{expandedId === e.id ? t('إخفاء', 'Hide') : t('التفاصيل', 'Details')}</span>
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
          setActionNotice(t('تم مسح سجل التشخيص من هذا الجهاز.', 'Diagnostic logs cleared from this device.'));
        }}
        title={t('مسح سجل التشخيص', 'Clear Diagnostic Logs')}
        message={t(
          'هل تريد مسح جميع أحداث التشخيص وأخطاء الشبكة المسجلة محلياً على هذا الجهاز؟',
          'Are you sure you want to clear all locally recorded diagnostic events and network errors?'
        )}
        confirmLabel={t('مسح السجل', 'Clear Log')}
        variant="danger"
      />
    </div>
  );
};

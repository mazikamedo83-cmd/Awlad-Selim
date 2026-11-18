import React, { useState, useEffect } from 'react';
import { Server, Wifi, CheckCircle2, AlertCircle, X, Search, QrCode, Loader2 } from 'lucide-react';
import {
  getConfiguredApiBaseUrl,
  getConnectionModeLabel,
  setConfiguredApiBaseUrl,
  testServerHealth,
} from '../../../services/api';
import { discoverServerCandidates, DiscoveredServerCandidate } from '../../../services/discovery';
import { isNativeCapacitor } from '../../../services/native';
import { useAuth } from '../../../context/AuthContext';
import { QrScannerModal } from '../../common/QrScannerModal';

interface MobileServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export const MobileServerModal: React.FC<MobileServerModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const { processDeepLinkOrPairingInput } = useAuth();
  const [urlInput, setUrlInput] = useState(() => getConfiguredApiBaseUrl());
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredServerCandidate[]>([]);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok?: boolean;
    message?: string;
    lanUrls?: string[];
  }>({});

  const nativeApp = isNativeCapacitor();

  useEffect(() => {
    if (isOpen) {
      setUrlInput(getConfiguredApiBaseUrl());
      setTestResult({});
      setDiscovered([]);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTest = async () => {
    setTesting(true);
    const res = await testServerHealth(urlInput);
    setTesting(false);
    if (res.ok) {
      setTestResult({
        ok: true,
        message: `متصل بـ ${res.companyName || 'السيرفر المركزي'} (${res.latencyMs}ms)${res.version ? ` — إصدار ${res.version}` : ''}`,
        lanUrls: res.lanUrls,
      });
    } else {
      setTestResult({
        ok: false,
        message: res.error || 'تعذر الاتصال بالسيرفر',
      });
    }
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    setTestResult({});
    try {
      const list = await discoverServerCandidates();
      setDiscovered(list);
      if (list[0]) {
        setUrlInput(list[0].url);
        setTestResult({
          ok: true,
          message: `تم اكتشاف السيرفر (${list[0].companyName || 'أولاد سليم'} • ${list[0].latencyMs}ms)`,
          lanUrls: list[0].lanUrls,
        });
      } else {
        setTestResult({
          ok: false,
          message: 'لم يتم العثور على سيرفر على شبكة الواي فاي المحلية. جرب مسح رمز QR أو لصق رابط الدعوة.',
        });
      }
    } finally {
      setDiscovering(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfiguredApiBaseUrl(urlInput);
    onClose();
    await onSaved();
  };

  const handleQrDetected = async (rawValue: string) => {
    setShowQrScanner(false);
    setTesting(true);
    const res = await processDeepLinkOrPairingInput(rawValue);
    setTesting(false);
    if (res.ok) {
      setUrlInput(getConfiguredApiBaseUrl());
      onClose();
      await onSaved();
    } else {
      setTestResult({ ok: false, message: res.error || 'تعذر تطبيق رابط الربط' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs">
      <form
        onSubmit={handleSave}
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-4 text-right pb-safe"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-900" />
            <h3 className="text-sm font-black text-slate-900">
              عنوان السيرفر المركزي (لابتوب المحل)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          اختر الاكتشاف التلقائي على شبكة الواي فاي، أو امسح رمز QR من الإدارة، أو أدخل رابط السيرفر مباشرة.
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={discovering}
            onClick={handleDiscover}
            className="flex-1 min-h-[40px] px-3 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-900 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {discovering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>{discovering ? 'جاري البحث...' : 'اكتشاف تلقائي (LAN)'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowQrScanner(true)}
            className="flex-1 min-h-[40px] px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>مسح QR / لصق دعوة</span>
          </button>
        </div>

        {discovered.length > 0 && (
          <div className="space-y-1.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[11px] font-bold text-slate-700 block">السيرفرات المكتشفة:</span>
            {discovered.map((d) => (
              <button
                key={d.url}
                type="button"
                onClick={() => setUrlInput(d.url)}
                className="w-full p-2 rounded-lg bg-white border border-slate-200 hover:border-emerald-400 flex items-center justify-between text-xs cursor-pointer"
              >
                <span className="font-mono font-bold text-slate-900" dir="ltr">{d.url}</span>
                <span className="text-[10px] text-emerald-700 font-bold">
                  {getConnectionModeLabel(d.activeMode)} • {d.latencyMs}ms
                </span>
              </button>
            ))}
          </div>
        )}

        <input
          type="text"
          dir="ltr"
          value={urlInput}
          onChange={(e) => {
            setUrlInput(e.target.value);
            setTestResult({});
          }}
          placeholder="http://192.168.1.100:3000"
          className="w-full rounded-xl border border-slate-300 px-3 py-3 text-xs font-mono text-left focus:border-blue-600 outline-hidden"
        />

        {!nativeApp && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setUrlInput('')}
              className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-bold cursor-pointer"
            >
              الخادم الحالي تلقائياً
            </button>
          </div>
        )}

        {testResult.message && (
          <div
            className={`p-3 rounded-xl border text-xs font-bold space-y-1 ${
              testResult.ok
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-700'
            }`}
          >
            <div className="flex items-center gap-2">
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              )}
              <span>{testResult.message}</span>
            </div>
            {testResult.lanUrls && testResult.lanUrls.length > 0 && (
              <p className="text-[11px] font-mono text-emerald-700" dir="ltr">
                LAN: {testResult.lanUrls.join(' · ')}
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={testing}
            onClick={handleTest}
            className="min-h-[44px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Wifi className="w-4 h-4" />
            <span>{testing ? 'جاري الفحص...' : 'اختبار الاتصال'}</span>
          </button>
          <button
            type="submit"
            className="min-h-[44px] flex-1 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-black cursor-pointer"
          >
            حفظ وتحديث البيانات
          </button>
        </div>
      </form>

      <QrScannerModal
        isOpen={showQrScanner}
        onClose={() => setShowQrScanner(false)}
        onDetected={handleQrDetected}
      />
    </div>
  );
};

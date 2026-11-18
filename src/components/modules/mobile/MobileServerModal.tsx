import React, { useState, useEffect } from 'react';
import { Server, Wifi, CheckCircle2, AlertCircle, X } from 'lucide-react';
import {
  getConfiguredApiBaseUrl,
  setConfiguredApiBaseUrl,
  testServerHealth,
} from '../../../services/api';
import { isNativeCapacitor } from '../../../services/native';

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
  const [urlInput, setUrlInput] = useState(() => getConfiguredApiBaseUrl());
  const [testing, setTesting] = useState(false);
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
        message: `متصل بالسيرفر المركزي (${res.latencyMs}ms)${res.version ? ` — إصدار ${res.version}` : ''}`,
        lanUrls: res.lanUrls,
      });
    } else {
      setTestResult({
        ok: false,
        message: res.error || 'تعذر الاتصال بالسيرفر',
      });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfiguredApiBaseUrl(urlInput);
    onClose();
    await onSaved();
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
          أدخل عنوان جهاز المحل على الواي فاي المحلي (مثال: <span className="font-mono" dir="ltr">http://192.168.1.100:3000</span>) أو رابط HTTPS الخاص بالمحل للاتصال من خارج المحل.
        </p>

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

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setUrlInput('http://192.168.1.100:3000')}
            className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-mono cursor-pointer"
          >
            http://192.168.1.100:3000
          </button>
          {!nativeApp && (
            <button
              type="button"
              onClick={() => setUrlInput('')}
              className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 text-[11px] font-bold cursor-pointer"
            >
              الخادم الحالي
            </button>
          )}
        </div>

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
    </div>
  );
};

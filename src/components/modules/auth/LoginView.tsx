import React, { useState, useEffect, useCallback } from 'react';
import {
  Lock, User, Eye, EyeOff, ShieldCheck, AlertCircle, Server, UserPlus, CheckCircle2, Wifi, QrCode, Link2, RefreshCw, Search, Loader2
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import {
  getConfiguredApiBaseUrl,
  getConnectionModeLabel,
  hasConfiguredServerUrl,
  setConfiguredApiBaseUrl,
  testServerHealth,
} from '../../../services/api';
import {
  autoDiscoverBestServer,
  discoverServerCandidates,
  DiscoveredServerCandidate,
} from '../../../services/discovery';
import { isNativeCapacitor } from '../../../services/native';
import { QrScannerModal } from '../../common/QrScannerModal';

export const LoginView: React.FC = () => {
  const {
    login,
    bootstrapAdmin,
    needsAdminSetup,
    refreshAuthContext,
    sessionExpiredMessage,
    clearSessionExpiredMessage,
    pairingNotice,
    clearPairingNotice,
    processDeepLinkOrPairingInput,
  } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [claimingInvite, setClaimingInvite] = useState(false);

  const [serverUrlInput, setServerUrlInput] = useState(() => getConfiguredApiBaseUrl());
  const [serverTestState, setServerTestState] = useState<{
    testing: boolean;
    ok?: boolean;
    message?: string;
    latencyMs?: number;
  }>({ testing: false });

  const [discoveryState, setDiscoveryState] = useState<{
    checking: boolean;
    online: boolean | null;
    companyName?: string;
    activeMode?: string;
    latencyMs?: number;
    error?: string;
  }>({ checking: true, online: null });
  const [discoveredCandidates, setDiscoveredCandidates] = useState<DiscoveredServerCandidate[]>([]);
  const [scanningLan, setScanningLan] = useState(false);

  const nativeApp = isNativeCapacitor();
  const configuredUrl = getConfiguredApiBaseUrl();
  const serverMissing = nativeApp && !hasConfiguredServerUrl();

  const verifyCurrentServerConnection = useCallback(async (runLanFallback = false) => {
    setDiscoveryState((prev) => ({ ...prev, checking: true, error: undefined }));
    const curUrl = getConfiguredApiBaseUrl();

    if (curUrl || !isNativeCapacitor()) {
      const check = await testServerHealth(curUrl);
      if (check.ok) {
        setDiscoveryState({
          checking: false,
          online: true,
          companyName: check.companyName || 'أولاد سليم',
          activeMode: check.activeMode || check.mode,
          latencyMs: check.latencyMs,
        });
        return;
      }
      if (!runLanFallback) {
        setDiscoveryState({
          checking: false,
          online: false,
          error: check.error || 'تعذر الوصول إلى السيرفر المركزي.',
        });
        return;
      }
    }

    // Attempt automatic LAN/saved fallback discovery
    const auto = await autoDiscoverBestServer();
    setDiscoveredCandidates(auto.candidates);
    if (auto.found && auto.best) {
      setDiscoveryState({
        checking: false,
        online: true,
        companyName: auto.best.companyName || 'أولاد سليم',
        activeMode: auto.best.activeMode,
        latencyMs: auto.best.latencyMs,
      });
      setServerUrlInput(auto.best.url);
    } else {
      setDiscoveryState({
        checking: false,
        online: false,
        error: curUrl
          ? 'السيرفر المحفوظ غير متاح حالياً. تأكد من تشغيل البرنامج على اللابتوب أو أعد اكتشاف السيرفر / امسح QR.'
          : 'لم يتم ربط هذا الجهاز بالسيرفر المركزي بعد.',
      });
    }
  }, []);

  useEffect(() => {
    verifyCurrentServerConnection(nativeApp);
  }, [nativeApp, verifyCurrentServerConnection]);

  useEffect(() => {
    setServerUrlInput(getConfiguredApiBaseUrl());
  }, [showServerModal]);

  const handleDiscoverServers = async () => {
    setScanningLan(true);
    setError(null);
    try {
      const list = await discoverServerCandidates();
      setDiscoveredCandidates(list);
      if (list.length > 0) {
        setServerUrlInput(list[0].url);
        setConfiguredApiBaseUrl(list[0].url);
        setDiscoveryState({
          checking: false,
          online: true,
          companyName: list[0].companyName || 'أولاد سليم',
          activeMode: list[0].activeMode,
          latencyMs: list[0].latencyMs,
        });
        await refreshAuthContext();
      } else {
        setDiscoveryState({
          checking: false,
          online: false,
          error: 'لم يتم العثور على سيرفر متاح تلقائياً على الشبكة الحالية. يمكنك مسح رمز QR أو لصق رابط الدعوة.',
        });
      }
    } finally {
      setScanningLan(false);
    }
  };

  const handleQrOrLinkDetected = async (rawValue: string) => {
    setShowQrScanner(false);
    setError(null);
    setClaimingInvite(true);
    try {
      const res = await processDeepLinkOrPairingInput(rawValue);
      if (res.ok) {
        setServerUrlInput(getConfiguredApiBaseUrl());
        await verifyCurrentServerConnection(false);
      } else if (res.error) {
        setError(res.error);
      }
    } finally {
      setClaimingInvite(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    clearSessionExpiredMessage();

    if (nativeApp && !hasConfiguredServerUrl()) {
      setError('يرجى ربط التطبيق بسيرفر المحل أولاً عبر مسح QR Code أو لصق رابط الدعوة أو الاكتشاف التلقائي.');
      setShowServerModal(true);
      return;
    }

    if (needsAdminSetup) {
      if (password.length < 6) {
        setError('كلمة المرور يجب أن لا تقل عن 6 أحرف أو أرقام');
        return;
      }
      if (password !== confirmPassword) {
        setError('كلمتا المرور غير متطابقتين');
        return;
      }
      setIsLoading(true);
      const res = await bootstrapAdmin({ fullName, username, password, phone });
      setIsLoading(false);
      if (!res.success) {
        setError(res.error || 'تعذر تهيئة حساب المدير العام');
      }
      return;
    }

    setIsLoading(true);
    const result = await login(username, password);
    setIsLoading(false);

    if (!result.success) {
      setError(result.error || 'فشل تسجيل الدخول، يرجى المحاولة مرة أخرى');
    }
  };

  const handleTestServer = async () => {
    setServerTestState({ testing: true });
    const res = await testServerHealth(serverUrlInput);
    if (res.ok) {
      setServerTestState({
        testing: false,
        ok: true,
        latencyMs: res.latencyMs,
        message: `تم الاتصال بنجاح (${res.companyName || 'أولاد سليم'} • ${res.latencyMs}ms)${res.version ? ` — الإصدار ${res.version}` : ''}`,
      });
    } else {
      setServerTestState({
        testing: false,
        ok: false,
        message: res.error || 'تعذر الاتصال بالسيرفر',
      });
    }
  };

  const handleSaveServerUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfiguredApiBaseUrl(serverUrlInput);
    setShowServerModal(false);
    setError(null);
    await refreshAuthContext();
    await verifyCurrentServerConnection(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden font-sans antialiased pt-safe pb-safe">
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-blue-600/10 blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-96 h-96 rounded-full bg-sky-500/10 blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden relative z-10 text-right animate-in fade-in duration-300">
        {/* Header / Logo banner */}
        <div className="bg-gradient-to-b from-blue-950 to-slate-900 p-8 text-center text-white relative">
          <div className="absolute top-4 left-4 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowQrScanner(true)}
              className="p-2 rounded-xl bg-emerald-600/90 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
              title="مسح رمز QR أو لصق رابط الدعوة"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">مسح QR / رابط</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setServerTestState({ testing: false });
                setShowServerModal(true);
              }}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-blue-100 text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="إعدادات عنوان السيرفر (للشبكة أو التطبيق)"
            >
              <Server className="w-3.5 h-3.5" />
              <span>{serverMissing ? 'إعداد السيرفر' : 'السيرفر'}</span>
            </button>
          </div>

          <img
            src="/awlad-selim-logo.png"
            alt="أولاد سليم AWLAD SELIM"
            className="max-h-24 mx-auto object-contain drop-shadow-md mb-3"
          />
          <h2 className="text-xl font-black tracking-tight text-white">
            نظام أولاد سليم للمحاسبة وإدارة الأعمال
          </h2>
          <p className="text-xs text-blue-200 mt-1 font-medium">
            {needsAdminSetup
              ? 'الإعداد الأولي: إنشاء حساب المالك والمدير العام للنظام'
              : 'بوابة تسجيل الدخول الآمن لتجارة المواد الغذائية بالجملة'}
          </p>
        </div>

        {/* Form Body */}
        <div className="p-6 sm:p-8 space-y-4">
          {/* Smart Server Discovery / Status Box */}
          <div
            className={`p-3.5 rounded-2xl border text-xs space-y-2.5 ${
              discoveryState.online === true
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                : discoveryState.online === false
                ? 'bg-amber-50 border-amber-300 text-amber-950'
                : 'bg-slate-50 border-slate-200 text-slate-800'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-black min-w-0">
                {discoveryState.checking || scanningLan || claimingInvite ? (
                  <Loader2 className="w-4 h-4 animate-spin text-blue-800 shrink-0" />
                ) : discoveryState.online ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <Server className="w-4 h-4 text-amber-700 shrink-0" />
                )}
                <span className="truncate">
                  {claimingInvite
                    ? 'جاري ربط الجهاز والتحقق من الدعوة...'
                    : discoveryState.checking || scanningLan
                    ? 'جاري التحقق من السيرفر المركزي...'
                    : discoveryState.online
                    ? `السيرفر متصل: ${discoveryState.companyName || 'أولاد سليم'}`
                    : serverMissing
                    ? 'الجهاز غير مرتبط بسيرفر المحل بعد'
                    : 'تعذر الوصول إلى السيرفر المركزي'}
                </span>
              </div>
              {discoveryState.online && discoveryState.latencyMs !== undefined && (
                <span className="px-2 py-0.5 rounded-lg bg-white border border-emerald-200 text-emerald-800 font-mono text-[10px] font-bold shrink-0">
                  {discoveryState.latencyMs}ms
                </span>
              )}
            </div>

            {discoveryState.online ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-emerald-800">
                <span>
                  الوضع: <strong>{getConnectionModeLabel(discoveryState.activeMode)}</strong>
                </span>
                {configuredUrl && (
                  <span dir="ltr" className="font-mono text-[10px] truncate max-w-[220px]">
                    {configuredUrl}
                  </span>
                )}
              </div>
            ) : (
              !discoveryState.checking && (
                <p className="text-[11px] leading-relaxed text-amber-900">
                  {discoveryState.error ||
                    'امسح رمز QR من شاشة الإدارة في اللابتوب أو الصق رابط الدعوة أو اضغط إعادة اكتشاف السيرفر.'}
                </p>
              )
            )}

            {(discoveryState.online === false || nativeApp) && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => verifyCurrentServerConnection(false)}
                  disabled={discoveryState.checking}
                  className="px-2.5 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${discoveryState.checking ? 'animate-spin' : ''}`} />
                  <span>إعادة المحاولة</span>
                </button>
                <button
                  type="button"
                  onClick={handleDiscoverServers}
                  disabled={scanningLan}
                  className="px-2.5 py-1.5 rounded-xl bg-white border border-blue-200 hover:bg-blue-50 text-blue-900 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Search className="w-3 h-3" />
                  <span>{scanningLan ? 'جاري البحث...' : 'إعادة اكتشاف السيرفر'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowQrScanner(true)}
                  className="px-2.5 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <QrCode className="w-3 h-3" />
                  <span>مسح QR Code</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowQrScanner(true)}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Link2 className="w-3 h-3" />
                  <span>لصق رابط الدعوة</span>
                </button>
              </div>
            )}

            {discoveredCandidates.length > 0 && discoveryState.online === false && (
              <div className="pt-2 border-t border-amber-200/80 space-y-1.5">
                <span className="text-[11px] font-bold block">سيرفرات مكتشفة متاحة للربط السريع:</span>
                <div className="flex flex-wrap gap-1.5">
                  {discoveredCandidates.map((cand) => (
                    <button
                      key={cand.url}
                      type="button"
                      onClick={async () => {
                        setConfiguredApiBaseUrl(cand.url);
                        setServerUrlInput(cand.url);
                        await refreshAuthContext();
                        await verifyCurrentServerConnection(false);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-white border border-emerald-300 text-emerald-900 text-[11px] font-mono font-bold hover:bg-emerald-50 cursor-pointer"
                      dir="ltr"
                    >
                      {cand.url} ({cand.latencyMs}ms)
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {pairingNotice && (
            <div
              className={`flex items-start justify-between gap-2 p-3.5 rounded-xl border text-xs font-bold ${
                pairingNotice.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : pairingNotice.type === 'warning'
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : pairingNotice.type === 'error'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-sky-50 border-sky-200 text-sky-900'
              }`}
            >
              <div className="flex items-start gap-2">
                {pairingNotice.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{pairingNotice.text}</span>
              </div>
              <button
                type="button"
                onClick={clearPairingNotice}
                className="text-[11px] underline shrink-0 cursor-pointer"
              >
                إخفاء
              </button>
            </div>
          )}

          {sessionExpiredMessage && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{sessionExpiredMessage}</span>
            </div>
          )}

          {needsAdminSetup && (
            <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-xs font-bold text-blue-900">
              لم يتم إعداد حساب مدير عام على هذا الخادم بعد. يرجى إنشاء حساب المالك الخاص بك الآن للبدء بأمان.
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {needsAdminSetup && (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    الاسم الكامل للمالك / المدير:
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="مثال: الحاج سليم / أحمد سليم"
                    className="w-full rounded-xl border border-slate-300 py-3 px-4 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all text-right"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    رقم الهاتف (اختياري):
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="01xxxxxxxxx"
                    className="w-full rounded-xl border border-slate-300 py-3 px-4 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all text-right"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                اسم المستخدم (أو رقم الهاتف):
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="أدخل اسم المستخدم"
                  className="w-full rounded-xl border border-slate-300 py-3 pr-10 pl-4 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all text-right"
                />
                <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5 pointer-events-none" />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  كلمة المرور:
                </label>
                {!needsAdminSetup && (
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(true)}
                    className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 transition-colors"
                  >
                    نسيت كلمة المرور؟
                  </button>
                )}
              </div>

              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="أدخل كلمة المرور"
                  className="w-full rounded-xl border border-slate-300 py-3 pr-10 pl-10 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all text-right"
                />
                <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5 pointer-events-none" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3.5 top-3.5 text-slate-400 hover:text-slate-600 focus:outline-hidden"
                  title={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {needsAdminSetup && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  تأكيد كلمة المرور:
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="أعد إدخال كلمة المرور"
                  className="w-full rounded-xl border border-slate-300 py-3 px-4 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all text-right"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 px-4 bg-blue-900 hover:bg-blue-950 text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-900/25 transition-all active:scale-98 disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer min-h-[46px]"
            >
              {needsAdminSetup ? <UserPlus className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
              <span>
                {isLoading
                  ? 'جاري التحقق والمصادقة...'
                  : needsAdminSetup
                  ? 'إنشاء حساب المدير العام والدخول'
                  : 'دخول النظام'}
              </span>
            </button>

            {!needsAdminSetup && (
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 font-medium text-center leading-relaxed">
                يدعم النظام الدخول دون إنترنت فقط للحسابات التي سبق التحقق منها على هذا الجهاز وبكلمة مرورها الصحيحة؛ وتُحدَّث الصلاحيات فور عودة الاتصال بالسيرفر المركزي.
              </div>
            )}
          </form>
        </div>

        <div className="bg-slate-50 border-t border-slate-100 px-6 py-3 text-center text-[11px] text-slate-500 font-medium">
          مؤسسة أولاد سليم لتجارة المواد الغذائية بالجملة • جميع الحقوق محفوظة 2026
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-2xl p-6 text-right shadow-2xl border border-slate-200">
            <h4 className="text-base font-bold text-slate-900 mb-2">استعادة كلمة المرور</h4>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              لأسباب أمنية، يتم إعادة ضبط كلمات المرور حصرياً من خلال مسؤول النظام داخل إدارة المستخدمين.
            </p>
            <button
              onClick={() => setShowForgotModal(false)}
              className="w-full py-2.5 bg-blue-900 text-white text-xs font-bold rounded-xl hover:bg-blue-950"
            >
              حسناً، فهمت
            </button>
          </div>
        </div>
      )}

      {/* Server URL Configuration Modal */}
      {showServerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <form onSubmit={handleSaveServerUrl} className="w-full max-w-md bg-white rounded-2xl p-6 text-right shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-2">
              <Server className="w-5 h-5 text-blue-900" />
              <h4 className="text-base font-black text-slate-900">إعداد عنوان السيرفر المركزي (لابتوب المحل)</h4>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              {nativeApp
                ? 'أدخل عنوان خادم أولاد سليم العامل على لابتوب المحل، أو امسح رمز QR / الصق رابط الدعوة للإعداد التلقائي.'
                : 'اترك الحقل فارغاً للاتصال التلقائي بنفس الخادم الحالي، أو أدخل رابط السيرفر المركزي.'}
            </p>
            <input
              type="text"
              dir="ltr"
              value={serverUrlInput}
              onChange={(e) => {
                setServerUrlInput(e.target.value);
                setServerTestState({ testing: false });
              }}
              placeholder="http://192.168.1.100:3000"
              className="w-full rounded-xl border border-slate-300 py-2.5 px-3 text-xs font-mono text-left focus:border-blue-600 outline-hidden"
            />
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={async () => {
                  setScanningLan(true);
                  const found = await discoverServerCandidates();
                  setScanningLan(false);
                  setDiscoveredCandidates(found);
                  if (found[0]) {
                    setServerUrlInput(found[0].url);
                    setServerTestState({
                      testing: false,
                      ok: true,
                      message: `تم اكتشاف السيرفر (${found[0].companyName || 'أولاد سليم'} • ${found[0].latencyMs}ms)`,
                    });
                  } else {
                    setServerTestState({
                      testing: false,
                      ok: false,
                      message: 'لم يتم العثور على سيرفر متاح تلقائياً على الشبكة المحلية.',
                    });
                  }
                }}
                disabled={scanningLan}
                className="px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <Search className="w-3 h-3" />
                <span>{scanningLan ? 'جاري البحث...' : 'اكتشاف تلقائي'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowServerModal(false);
                  setShowQrScanner(true);
                }}
                className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                <QrCode className="w-3 h-3" />
                <span>مسح QR / لصق دعوة</span>
              </button>
              {!nativeApp && (
                <button
                  type="button"
                  onClick={() => setServerUrlInput('')}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold cursor-pointer"
                >
                  تلقائي (نفس الخادم)
                </button>
              )}
            </div>

            {serverTestState.message && (
              <div
                className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 border ${
                  serverTestState.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {serverTestState.ok ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                )}
                <span>{serverTestState.message}</span>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={serverTestState.testing}
                onClick={handleTestServer}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <Wifi className="w-3.5 h-3.5" />
                <span>{serverTestState.testing ? 'جاري الفحص...' : 'اختبار الاتصال'}</span>
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-blue-900 text-white text-xs font-bold rounded-xl hover:bg-blue-950 cursor-pointer"
              >
                حفظ وإعادة الفحص
              </button>
              <button
                type="button"
                onClick={() => setShowServerModal(false)}
                className="px-4 py-2.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      <QrScannerModal
        isOpen={showQrScanner}
        onClose={() => setShowQrScanner(false)}
        onDetected={handleQrOrLinkDetected}
      />
    </div>
  );
};

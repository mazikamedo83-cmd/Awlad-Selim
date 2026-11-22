import React, { useRef, useState } from 'react';
import {
  Lock, User, Eye, EyeOff, ShieldCheck, AlertCircle, Server, UserPlus, QrCode, Search, CheckCircle2, Loader2, Users, Trash2, ArrowRightCircle
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import {
  detectModeFromUrl,
  getConfiguredApiBaseUrl,
  getConnectionModeLabel,
  getStoredConnectionProfiles,
  hasConfiguredServerUrl,
  saveFallbackEndpoints,
  saveStoredConnectionProfiles,
  setConfiguredApiBaseUrl,
} from '../../../services/api';
import { claimPairingInvitation, discoverServerCandidates } from '../../../services/discovery';
import { isNativeCapacitor } from '../../../services/native';
import { QrScannerModal } from '../../common/QrScannerModal';
import { MobileServerModal } from '../mobile/MobileServerModal';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { SavedDeviceAccount } from '../../../services/accountVault';

function getRoleBadgeText(role: string): string {
  switch (role) {
    case 'admin':
      return 'مدير عام';
    case 'manager':
      return 'مدير فرع';
    case 'accountant':
      return 'محاسب مالي';
    case 'warehouse':
      return 'أمين مستودع';
    case 'sales':
      return 'مبيعات';
    case 'purchases':
      return 'مشتريات';
    case 'representative':
      return 'مندوب';
    case 'customer':
      return 'عميل';
    default:
      return role;
  }
}

export const LoginView: React.FC = () => {
  const {
    login,
    registerAccount,
    bootstrapAdmin,
    needsAdminSetup,
    refreshAuthContext,
    sessionExpiredMessage,
    clearSessionExpiredMessage,
    isDatabaseUnavailable,
    databaseUnavailableMessage,
    pairingBanner,
    setPairingBanner,
    clearPairingBanner,
    savedAccounts,
    resumeSavedAccount,
    removeSavedAccountFromDevice,
  } = useAuth();
  const [authMode, setAuthMode] = useState<'login' | 'register_customer' | 'register_rep'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [shopName, setShopName] = useState('');
  const [governorate, setGovernorate] = useState('');
  const [area, setArea] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [resumingUserId, setResumingUserId] = useState<string | null>(null);
  const [accountToForget, setAccountToForget] = useState<SavedDeviceAccount | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isClaimingQr, setIsClaimingQr] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  const handleResumeSavedAccount = async (acc: SavedDeviceAccount) => {
    setError(null);
    setInfoNotice(null);
    clearSessionExpiredMessage();
    setResumingUserId(acc.userId);
    try {
      const res = await resumeSavedAccount(acc.userId);
      if (!res.success) {
        setAuthMode('login');
        setUsername(acc.username);
        setPassword('');
        setInfoNotice(
          res.needsPassword
            ? `أدخل كلمة مرور الحساب (${acc.fullName}) لإعادة التفعيل بأمان.`
            : res.error || 'يرجى تسجيل الدخول بكلمة المرور.'
        );
        window.setTimeout(() => {
          passwordInputRef.current?.focus();
        }, 60);
      }
    } finally {
      setResumingUserId(null);
    }
  };

  const nativeApp = isNativeCapacitor();
  const serverMissing = nativeApp && !hasConfiguredServerUrl();
  const currentApiUrl = getConfiguredApiBaseUrl();
  const activeModeLabel = currentApiUrl
    ? getConnectionModeLabel(detectModeFromUrl(currentApiUrl, getStoredConnectionProfiles()))
    : 'الاتصال المباشر بالسيرفر';

  const handleQuickDiscover = async () => {
    setError(null);
    clearPairingBanner();
    setIsDiscovering(true);
    try {
      const results = await discoverServerCandidates();
      if (results.length === 1) {
        const srv = results[0];
        if (srv.profiles) saveStoredConnectionProfiles(srv.profiles);
        if (Array.isArray(srv.fallbackEndpoints)) saveFallbackEndpoints(srv.fallbackEndpoints);
        setConfiguredApiBaseUrl(srv.url);
        setPairingBanner({
          type: 'success',
          message: `تم اكتشاف السيرفر المركزي تلقائياً (${srv.url}). يرجى تسجيل الدخول بحسابك.`,
        });
        await refreshAuthContext();
      } else if (results.length > 1) {
        setShowServerModal(true);
      } else {
        setError('لم يتم العثور على سيرفر على الشبكة المحلية. تأكد من الاتصال بالـ Wi-Fi أو استخدم رمز QR / رابط الدعوة.');
      }
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleQrDetected = async (rawText: string) => {
    setShowQrScanner(false);
    setError(null);
    clearPairingBanner();
    setIsClaimingQr(true);
    const res = await claimPairingInvitation(rawText);
    setIsClaimingQr(false);
    if (!res.ok) {
      setError(res.error || 'تعذر ربط الجهاز عبر الرمز أو الرابط.');
      return;
    }
    setPairingBanner({
      type: res.requiresAdminApproval ? 'warning' : 'success',
      message: res.requiresAdminApproval
        ? `تم إعداد السيرفر (${res.companyName || ''}). هذا الجهاز بانتظار موافقة مدير النظام، وبعدها يمكنك تسجيل الدخول بحسابك.`
        : `تم ربط الجهاز بسيرفر (${res.companyName || ''}) بنجاح (${res.endpointUrl}). أدخل اسم المستخدم وكلمة المرور للدخول.`,
    });
    await refreshAuthContext();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    clearSessionExpiredMessage();

    if (nativeApp && !hasConfiguredServerUrl()) {
      setError('يرجى ضبط عنوان السيرفر المركزي (لابتوب المحل) أولاً من زر "إعداد السيرفر" بالأعلى.');
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
      const res = await bootstrapAdmin({
        fullName,
        username,
        password,
        phone,
        ...(companyName.trim() ? { companyName: companyName.trim() } : {}),
      });
      setIsLoading(false);
      if (!res.success) {
        setError(res.error || 'تعذر تهيئة حساب المدير العام');
      }
      return;
    }

    if (!needsAdminSetup && (authMode === 'register_customer' || authMode === 'register_rep')) {
      if (fullName.trim().length < 2) {
        setError('يرجى إدخال الاسم الكامل (حرفين على الأقل)');
        return;
      }
      if (!phone.trim()) {
        setError('يرجى إدخال رقم الهاتف للتسجيل');
        return;
      }
      if (username.trim().length < 3) {
        setError('اسم المستخدم يجب أن لا يقل عن 3 أحرف');
        return;
      }
      if (password.length < 6) {
        setError('كلمة المرور يجب أن لا تقل عن 6 أحرف أو أرقام');
        return;
      }
      if (password !== confirmPassword) {
        setError('كلمتا المرور غير متطابقتين');
        return;
      }
      setIsLoading(true);
      const res = await registerAccount({
        role: authMode === 'register_customer' ? 'customer' : 'representative',
        fullName: fullName.trim(),
        phone: phone.trim(),
        username: username.trim(),
        password,
        address: address.trim(),
        shopName: authMode === 'register_customer' ? shopName.trim() : undefined,
        governorate: authMode === 'register_customer' ? governorate.trim() : undefined,
        area: authMode === 'register_customer' ? area.trim() : undefined,
        vehicleNumber: authMode === 'register_rep' ? vehicleNumber.trim() : undefined,
      });
      setIsLoading(false);
      if (!res.success) {
        setError(res.error || 'تعذر إنشاء الحساب الجديد');
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

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden font-sans pt-safe pb-safe">
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-blue-600/10 blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-96 h-96 rounded-full bg-sky-500/10 blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden relative z-10 text-right animate-in fade-in duration-300">
        {/* Header / Logo banner */}
        <div className="bg-gradient-to-b from-blue-950 to-slate-900 p-8 text-center text-white relative">
          <button
            type="button"
            onClick={() => setShowServerModal(true)}
            className="absolute top-4 left-4 px-2.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-blue-100 text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            title={activeModeLabel}
          >
            <Server className="w-3.5 h-3.5" />
            <span>{serverMissing ? 'إعداد السيرفر' : 'أوضاع الاتصال'}</span>
          </button>

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
        <div className="p-6 sm:p-8 space-y-5">
          {pairingBanner && (
            <div
              className={`p-3.5 rounded-xl border text-xs font-bold flex items-start gap-2.5 ${
                pairingBanner.type === 'success'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : pairingBanner.type === 'warning'
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {pairingBanner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed">{pairingBanner.message}</span>
            </div>
          )}

          {serverMissing ? (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-900 space-y-2.5">
              <div className="font-black flex items-center gap-2">
                <Server className="w-4 h-4 text-amber-700 shrink-0" />
                <span>الخطوة الأولى: ربط التطبيق بالسيرفر المركزي</span>
              </div>
              <p className="leading-relaxed">
                امسح رمز <span className="font-mono font-bold">QR Code</span> من لوحة الإدارة أو اضغط بحث تلقائي داخل الشبكة دون كتابة IP يدوياً.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isClaimingQr}
                  onClick={() => setShowQrScanner(true)}
                  className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>{isClaimingQr ? 'جاري الربط...' : 'مسح QR أو لصق رابط دعوة'}</span>
                </button>
                <button
                  type="button"
                  disabled={isDiscovering}
                  onClick={handleQuickDiscover}
                  className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {isDiscovering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>{isDiscovering ? 'جاري الاكتشاف...' : 'اكتشاف السيرفر تلقائياً'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowServerModal(true)}
                  className="px-3.5 py-2 rounded-xl bg-white border border-amber-300 text-amber-900 font-bold text-xs cursor-pointer"
                >
                  إعداد يدوي
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px]">
              <div className="flex items-center gap-1.5 text-slate-600 font-bold truncate">
                <Server className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span className="truncate">{activeModeLabel}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={isClaimingQr}
                  onClick={() => setShowQrScanner(true)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <QrCode className="w-3 h-3" />
                  <span>ربط بـ QR / رابط</span>
                </button>
                <button
                  type="button"
                  disabled={isDiscovering}
                  onClick={handleQuickDiscover}
                  className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-bold flex items-center gap-1 cursor-pointer"
                >
                  {isDiscovering ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                  <span>بحث تلقائي</span>
                </button>
              </div>
            </div>
          )}

          {isDatabaseUnavailable && databaseUnavailableMessage && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-800">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{databaseUnavailableMessage}</span>
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

          {typeof navigator !== 'undefined' && navigator.onLine === false && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-700 mt-0.5" />
              <span className="leading-relaxed">
                أنت الآن في وضع العمل دون إنترنت: يُسمح بتسجيل الدخول محلياً فقط للحسابات التي سبق التحقق منها بنجاح على هذا الجهاز، وسيتم إعادة التحقق من الصلاحيات فور عودة الاتصال بالسيرفر المركزي.
              </span>
            </div>
          )}

          {infoNotice && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-xs font-bold text-blue-900">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-blue-700" />
              <span>{infoNotice}</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!needsAdminSetup && savedAccounts.length > 0 && (
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-900 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-blue-800" />
                  <span>الحسابات المحفوظة على الجهاز ({savedAccounts.length})</span>
                </span>
                <span className="text-[10px] font-bold text-slate-500">تبديل ودخول سريع آمن</span>
              </div>
              <div className="space-y-2 max-h-52 overflow-y-auto">
                {savedAccounts.map((acc) => {
                  const isResuming = resumingUserId === acc.userId;
                  const quickReady = acc.sessionStatus === 'active' && Boolean(acc.refreshToken || acc.accessToken);
                  return (
                    <div
                      key={acc.userId}
                      className="p-2.5 rounded-xl bg-white border border-slate-200 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {acc.avatarPhoto ? (
                          <img
                            src={acc.avatarPhoto}
                            alt={acc.fullName}
                            className="w-9 h-9 rounded-xl object-cover border border-slate-200 shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-xl bg-blue-900 text-white font-black text-xs flex items-center justify-center shrink-0">
                            {(acc.fullName || acc.username || '؟').trim().charAt(0)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-black text-xs text-slate-900 truncate">{acc.fullName}</span>
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-900 text-[10px] font-bold">
                              {getRoleBadgeText(acc.role)}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 font-mono truncate">
                            @{acc.username}
                            {acc.shopName ? ` · ${acc.shopName}` : ''}
                            {quickReady ? ' · جلسة جاهزة' : ' · يتطلب كلمة المرور'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={Boolean(resumingUserId)}
                          onClick={() => handleResumeSavedAccount(acc)}
                          className={`min-h-[36px] px-2.5 rounded-lg text-[11px] font-black flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                            quickReady
                              ? 'bg-blue-900 hover:bg-blue-950 text-white'
                              : 'bg-amber-100 hover:bg-amber-200 text-amber-950'
                          }`}
                        >
                          {isResuming ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <ArrowRightCircle className="w-3.5 h-3.5" />
                          )}
                          <span>{isResuming ? 'جاري...' : quickReady ? 'دخول' : 'تحديد'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(resumingUserId)}
                          onClick={() => setAccountToForget(acc)}
                          className="min-h-[36px] min-w-[36px] rounded-lg bg-red-50 hover:bg-red-100 text-red-700 flex items-center justify-center cursor-pointer"
                          title="إزالة الحساب من الجهاز"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!needsAdminSetup && (
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-slate-100 border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('login');
                  setError(null);
                  setInfoNotice(null);
                }}
                className={`min-h-[42px] px-2 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  authMode === 'login'
                    ? 'bg-blue-900 text-white shadow-xs font-black'
                    : 'text-slate-700 hover:bg-white'
                }`}
              >
                تسجيل الدخول
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('register_customer');
                  setError(null);
                  setInfoNotice(null);
                  setPassword('');
                  setConfirmPassword('');
                }}
                className={`min-h-[42px] px-2 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  authMode === 'register_customer'
                    ? 'bg-blue-900 text-white shadow-xs font-black'
                    : 'text-slate-700 hover:bg-white'
                }`}
              >
                تسجيل عميل جديد
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('register_rep');
                  setError(null);
                  setInfoNotice(null);
                  setPassword('');
                  setConfirmPassword('');
                }}
                className={`min-h-[42px] px-2 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  authMode === 'register_rep'
                    ? 'bg-blue-900 text-white shadow-xs font-black'
                    : 'text-slate-700 hover:bg-white'
                }`}
              >
                تسجيل مندوب جديد
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {needsAdminSetup && (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    اسم الشركة / النشاط (اختياري):
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="أدخل اسم الشركة أو المؤسسة"
                    className="w-full rounded-xl border border-slate-300 py-3 px-4 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all text-right"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    الاسم الكامل للمالك / المدير:
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="أدخل الاسم الكامل للمالك أو المدير العام"
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

            {!needsAdminSetup && (authMode === 'register_customer' || authMode === 'register_rep') && (
              <div className="space-y-3 p-3.5 rounded-2xl bg-blue-50/60 border border-blue-200/80">
                <p className="text-xs font-black text-blue-950">
                  {authMode === 'register_customer'
                    ? 'بيانات العميل الجديد (تُفعّل مباشرة للدخول والطلب)'
                    : 'بيانات المندوب الجديد (تُفعّل مباشرة مع مخزن سيارة خاص)'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">الاسم الكامل *</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder={authMode === 'register_customer' ? 'اسم العميل أو المسؤول' : 'اسم المندوب الثلاثي'}
                      className="w-full rounded-xl border border-slate-300 bg-white py-2.5 px-3 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 outline-hidden text-right"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">رقم الهاتف *</label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="01xxxxxxxxx"
                      className="w-full rounded-xl border border-slate-300 bg-white py-2.5 px-3 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 outline-hidden text-right"
                    />
                  </div>
                  {authMode === 'register_customer' ? (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">اسم المحل / النشاط</label>
                        <input
                          type="text"
                          value={shopName}
                          onChange={(e) => setShopName(e.target.value)}
                          placeholder="مثال: سوبر ماركت النور"
                          className="w-full rounded-xl border border-slate-300 bg-white py-2.5 px-3 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 outline-hidden text-right"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">المحافظة</label>
                        <input
                          type="text"
                          value={governorate}
                          onChange={(e) => setGovernorate(e.target.value)}
                          placeholder="مثال: القاهرة / الجيزة"
                          className="w-full rounded-xl border border-slate-300 bg-white py-2.5 px-3 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 outline-hidden text-right"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">المنطقة</label>
                        <input
                          type="text"
                          value={area}
                          onChange={(e) => setArea(e.target.value)}
                          placeholder="مثال: شبرا / المعادي"
                          className="w-full rounded-xl border border-slate-300 bg-white py-2.5 px-3 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 outline-hidden text-right"
                        />
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">رقم السيارة / الخط</label>
                      <input
                        type="text"
                        value={vehicleNumber}
                        onChange={(e) => setVehicleNumber(e.target.value)}
                        placeholder="مثال: أ ب ج 1234"
                        className="w-full rounded-xl border border-slate-300 bg-white py-2.5 px-3 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 outline-hidden text-right"
                      />
                    </div>
                  )}
                  <div className={authMode === 'register_customer' ? '' : ''}>
                    <label className="block text-xs font-bold text-slate-700 mb-1">العنوان</label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="العنوان التفصيلي"
                      className="w-full rounded-xl border border-slate-300 bg-white py-2.5 px-3 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 outline-hidden text-right"
                    />
                  </div>
                </div>
              </div>
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
                  ref={passwordInputRef}
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

            {(needsAdminSetup || authMode === 'register_customer' || authMode === 'register_rep') && (
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
              {needsAdminSetup || authMode !== 'login' ? (
                <UserPlus className="w-4 h-4" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              <span>
                {isLoading
                  ? 'جاري التحقق والمصادقة...'
                  : needsAdminSetup
                  ? 'إنشاء حساب المدير العام والدخول'
                  : authMode === 'register_customer'
                  ? 'إنشاء حساب العميل والدخول'
                  : authMode === 'register_rep'
                  ? 'إنشاء حساب المندوب والدخول'
                  : 'دخول النظام'}
              </span>
            </button>
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

      {/* Unified 4-Mode Server Connection Modal */}
      <MobileServerModal
        isOpen={showServerModal}
        onClose={() => setShowServerModal(false)}
        onSaved={async () => {
          setError(null);
          await refreshAuthContext();
        }}
      />

      <QrScannerModal
        isOpen={showQrScanner}
        onClose={() => setShowQrScanner(false)}
        onDetected={handleQrDetected}
      />

      <ConfirmDialog
        isOpen={Boolean(accountToForget)}
        onClose={() => setAccountToForget(null)}
        onConfirm={async () => {
          if (!accountToForget) return;
          await removeSavedAccountFromDevice(accountToForget.userId);
          setAccountToForget(null);
          setInfoNotice('تمت إزالة الحساب من هذا الجهاز فقط دون التأثير على حساباتك الأخرى أو بيانات السيرفر.');
        }}
        variant="danger"
        title="إزالة الحساب من الجهاز؟"
        message={
          accountToForget
            ? `هل تريد إزالة الحساب (${accountToForget.fullName} - @${accountToForget.username}) من قائمة الحسابات المحفوظة على هذا الجهاز؟`
            : ''
        }
        confirmLabel="نعم، إزالة من الجهاز"
      />
    </div>
  );
};

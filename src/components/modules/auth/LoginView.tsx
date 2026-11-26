import React, { useRef, useState } from 'react';
import {
  Lock, User, Eye, EyeOff, ShieldCheck, AlertCircle, Server, UserPlus, QrCode, Search, CheckCircle2, Loader2, Users, Trash2, ArrowRightCircle, Globe
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { usePreferences } from '../../../context/PreferencesContext';
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
import { CustomerLocationPickerModal, PickedCustomerLocation } from '../../common/CustomerLocationPickerModal';
import { SavedDeviceAccount } from '../../../services/accountVault';
import { MapPin } from 'lucide-react';
import { isZeroZeroLocation } from '../../../utils/storefront';

function getRoleBadgeText(role: string, t: (ar: string, en?: string) => string): string {
  switch (role) {
    case 'admin':
      return t('مدير عام', 'General Manager');
    case 'manager':
      return t('مدير فرع', 'Branch Manager');
    case 'accountant':
      return t('محاسب مالي', 'Financial Accountant');
    case 'warehouse':
      return t('أمين مستودع', 'Warehouse Keeper');
    case 'sales':
      return t('مبيعات', 'Sales');
    case 'purchases':
      return t('مشتريات', 'Purchases');
    case 'representative':
      return t('مندوب', 'Sales Rep');
    case 'customer':
      return t('عميل', 'Customer');
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
  const { language, dir, setLanguage, t } = usePreferences();
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
  const [city, setCity] = useState('');
  const [latitude, setLatitude] = useState<number | undefined>(undefined);
  const [longitude, setLongitude] = useState<number | undefined>(undefined);
  const [locationCapturedAt, setLocationCapturedAt] = useState<string | undefined>(undefined);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
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
            ? t(
                `أدخل كلمة مرور الحساب (${acc.fullName}) لإعادة التفعيل بأمان.`,
                `Enter password for (${acc.fullName}) to re-activate securely.`
              )
            : res.error ? t(res.error) : t('يرجى تسجيل الدخول بكلمة المرور.', 'Please sign in with your password.')
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
    ? t(getConnectionModeLabel(detectModeFromUrl(currentApiUrl, getStoredConnectionProfiles())))
    : t('الاتصال المباشر بالسيرفر', 'Direct Server Connection');

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
          message: t(
            `تم اكتشاف السيرفر المركزي تلقائياً (${srv.url}). يرجى تسجيل الدخول بحسابك.`,
            `Central server discovered automatically (${srv.url}). Please sign in with your account.`
          ),
        });
        await refreshAuthContext();
      } else if (results.length > 1) {
        setShowServerModal(true);
      } else {
        setError(
          t(
            'لم يتم العثور على سيرفر على الشبكة المحلية. تأكد من الاتصال بالـ Wi-Fi أو استخدم رمز QR / رابط الدعوة.',
            'No server found on the local network. Ensure Wi-Fi connection or use QR code / invite link.'
          )
        );
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
      setError(res.error ? t(res.error) : t('تعذر ربط الجهاز عبر الرمز أو الرابط.', 'Could not pair device via code or link.'));
      return;
    }
    setPairingBanner({
      type: res.requiresAdminApproval ? 'warning' : 'success',
      message: res.requiresAdminApproval
        ? t(
            `تم إعداد السيرفر (${res.companyName || ''}). هذا الجهاز بانتظار موافقة مدير النظام، وبعدها يمكنك تسجيل الدخول بحسابك.`,
            `Server configured (${res.companyName || ''}). This device is awaiting admin approval before you can sign in.`
          )
        : t(
            `تم ربط الجهاز بسيرفر (${res.companyName || ''}) بنجاح (${res.endpointUrl}). أدخل اسم المستخدم وكلمة المرور للدخول.`,
            `Device paired with server (${res.companyName || ''}) successfully (${res.endpointUrl}). Enter your username and password to sign in.`
          ),
    });
    await refreshAuthContext();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    clearSessionExpiredMessage();

    if (nativeApp && !hasConfiguredServerUrl()) {
      setError(
        t(
          'يرجى ضبط عنوان السيرفر المركزي (لابتوب المحل) أولاً من زر "إعداد السيرفر" بالأعلى.',
          'Please configure the central server address first using the "Server Setup" button above.'
        )
      );
      setShowServerModal(true);
      return;
    }

    if (needsAdminSetup) {
      if (password.length < 6) {
        setError(t('كلمة المرور يجب أن لا تقل عن 6 أحرف أو أرقام', 'Password must be at least 6 characters'));
        return;
      }
      if (password !== confirmPassword) {
        setError(t('كلمتا المرور غير متطابقتين', 'Passwords do not match'));
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
        setError(res.error ? t(res.error) : t('تعذر تهيئة حساب المدير العام', 'Could not initialize General Manager account'));
      }
      return;
    }

    if (!needsAdminSetup && (authMode === 'register_customer' || authMode === 'register_rep')) {
      if (fullName.trim().length < 2) {
        setError(t('يرجى إدخال الاسم الكامل (حرفين على الأقل)', 'Please enter full name (at least 2 characters)'));
        return;
      }
      if (!phone.trim()) {
        setError(t('يرجى إدخال رقم الهاتف للتسجيل', 'Please enter phone number to register'));
        return;
      }
      if (username.trim().length < 3) {
        setError(t('اسم المستخدم يجب أن لا يقل عن 3 أحرف', 'Username must be at least 3 characters'));
        return;
      }
      if (password.length < 6) {
        setError(t('كلمة المرور يجب أن لا تقل عن 6 أحرف أو أرقام', 'Password must be at least 6 characters'));
        return;
      }
      if (password !== confirmPassword) {
        setError(t('كلمتا المرور غير متطابقتين', 'Passwords do not match'));
        return;
      }
      if (
        authMode === 'register_customer' &&
        latitude !== undefined &&
        longitude !== undefined &&
        isZeroZeroLocation(latitude, longitude)
      ) {
        setError(t('إحداثيات الموقع (0, 0) غير صالحة — يرجى تحديد موقع حقيقي على الخريطة.', 'Location coordinates (0, 0) are invalid — please pick a real location on the map.'));
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
        city: authMode === 'register_customer' ? (city.trim() || area.trim() || undefined) : undefined,
        latitude: authMode === 'register_customer' ? latitude : undefined,
        longitude: authMode === 'register_customer' ? longitude : undefined,
        locationCapturedAt: authMode === 'register_customer' ? locationCapturedAt : undefined,
        vehicleNumber: authMode === 'register_rep' ? vehicleNumber.trim() : undefined,
      });
      setIsLoading(false);
      if (!res.success) {
        setError(res.error ? t(res.error) : t('تعذر إنشاء الحساب الجديد', 'Could not create new account'));
      }
      return;
    }

    setIsLoading(true);
    const result = await login(username, password);
    setIsLoading(false);

    if (!result.success) {
      setError(result.error ? t(result.error) : t('فشل تسجيل الدخول، يرجى المحاولة مرة أخرى', 'Login failed, please try again'));
    }
  };

  return (
    <div dir={dir} className="min-h-screen bg-slate-900 dark:bg-[#081326] flex items-center justify-center p-2.5 sm:p-4 relative overflow-hidden font-sans pt-safe pb-safe">
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-blue-600/10 dark:bg-[#1659C8]/15 blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-96 h-96 rounded-full bg-[#003589]/15 dark:bg-[#1D63D8]/12 blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-lg bg-white dark:bg-[#0E1C36] rounded-xl shadow-2xl border border-slate-200 dark:border-[#21375C] overflow-hidden relative z-10 text-start animate-in fade-in duration-300">
        {/* Header / Logo banner */}
        <div className="awlad-brand-gradient p-3.5 text-center text-white relative">
          <button
            type="button"
            onClick={() => setShowServerModal(true)}
            className="absolute top-2.5 end-2.5 px-2 py-1 rounded-md bg-white/15 hover:bg-white/25 text-white text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
            title={activeModeLabel}
          >
            <Server className="w-3.5 h-3.5" />
            <span>{serverMissing ? t('إعداد السيرفر', 'Server Setup') : t('أوضاع الاتصال', 'Connection Modes')}</span>
          </button>

          <button
            type="button"
            data-testid="login-language-toggle"
            onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
            className="absolute top-2.5 start-2.5 px-2 py-1 rounded-md bg-white/15 hover:bg-white/25 text-white text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
            title={language === 'ar' ? 'Switch interface to English' : 'تغيير الواجهة إلى العربية'}
            aria-label={language === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{language === 'ar' ? 'English' : 'العربية'}</span>
          </button>

          <div className="bg-white dark:bg-white no-dark-surface rounded-lg px-3 py-1.5 inline-flex items-center justify-center border border-white/80 mb-1.5">
            <img
              src="/awlad-selim-logo.png"
              alt="AWLAD SELIM"
              className="max-h-11 mx-auto object-contain"
            />
          </div>
          <h2 className="text-base font-black tracking-tight text-white">
            {t('نظام أولاد سليم للمحاسبة وإدارة الأعمال', 'AWLAD SELIM Accounting & Business Management')}
          </h2>
          <p className="text-[11px] text-blue-100 mt-0.5 font-medium">
            {needsAdminSetup
              ? t('الإعداد الأولي: إنشاء حساب المالك والمدير العام للنظام', 'Initial Setup: Create System Owner & General Manager Account')
              : t('بوابة تسجيل الدخول الآمن لتجارة المواد الغذائية بالجملة', 'Secure Sign-In Portal for Wholesale Food Trading')}
          </p>
        </div>

        {/* Form Body */}
        <div className="p-3 sm:p-4 space-y-2">
          {pairingBanner && (
            <div
              className={`p-2.5 rounded-lg border text-xs font-bold flex items-start gap-2 ${
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
              <span className="leading-relaxed">{t(pairingBanner.message)}</span>
            </div>
          )}

          {serverMissing ? (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-900 space-y-2">
              <div className="font-black flex items-center gap-1.5">
                <Server className="w-4 h-4 text-amber-700 shrink-0" />
                <span>{t('الخطوة الأولى: ربط التطبيق بالسيرفر المركزي', 'Step 1: Pair App with Central Server')}</span>
              </div>
              <p className="leading-relaxed text-[11px]">
                {t(
                  'امسح رمز QR Code من لوحة الإدارة أو اضغط بحث تلقائي داخل الشبكة دون كتابة IP يدوياً.',
                  'Scan the QR Code from the Admin panel or click Auto-Discover on the local network without typing an IP manually.'
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={isClaimingQr}
                  onClick={() => setShowQrScanner(true)}
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--awlad-royal-700)] hover:bg-[var(--awlad-royal-600)] text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>{isClaimingQr ? t('جاري الربط...', 'Pairing...') : t('مسح QR أو لصق رابط دعوة', 'Scan QR or Paste Invite Link')}</span>
                </button>
                <button
                  type="button"
                  disabled={isDiscovering}
                  onClick={handleQuickDiscover}
                  className="px-2.5 py-1.5 rounded-lg bg-[var(--awlad-navy-900)] hover:bg-[var(--awlad-navy-950)] text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {isDiscovering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>{isDiscovering ? t('جاري الاكتشاف...', 'Discovering...') : t('اكتشاف السيرفر تلقائياً', 'Auto-Discover Server')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowServerModal(true)}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-900 font-bold text-xs cursor-pointer"
                >
                  {t('إعداد يدوي', 'Manual Setup')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#EEF3FA] dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#21375C] text-[11px]">
              <div className="flex items-center gap-1.5 text-[var(--awlad-navy-950)] dark:text-[#DCE6F5] font-bold truncate">
                <Server className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#85B8FF] shrink-0" />
                <span className="truncate">{activeModeLabel}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={isClaimingQr}
                  onClick={() => setShowQrScanner(true)}
                  className="px-2 py-1 rounded bg-white dark:bg-[#0E1C36] hover:bg-[#DCE6F5] dark:hover:bg-[#1A3461] text-[var(--awlad-navy-900)] dark:text-[#DCE6F5] border border-slate-300 dark:border-[#2A436E] font-bold flex items-center gap-1 cursor-pointer"
                >
                  <QrCode className="w-3 h-3 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
                  <span>{t('ربط بـ QR / رابط', 'Pair via QR / Link')}</span>
                </button>
                <button
                  type="button"
                  disabled={isDiscovering}
                  onClick={handleQuickDiscover}
                  className="px-2 py-1 rounded bg-white dark:bg-[#0E1C36] hover:bg-slate-100 dark:hover:bg-[#1A3461] text-slate-700 dark:text-[#A9BCD9] border border-slate-300 dark:border-[#2A436E] font-bold flex items-center gap-1 cursor-pointer"
                >
                  {isDiscovering ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                  <span>{t('بحث تلقائي', 'Auto Search')}</span>
                </button>
              </div>
            </div>
          )}

          {isDatabaseUnavailable && databaseUnavailableMessage && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-bold text-red-800">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{t(databaseUnavailableMessage)}</span>
            </div>
          )}

          {sessionExpiredMessage && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{t(sessionExpiredMessage)}</span>
            </div>
          )}

          {needsAdminSetup && (
            <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs font-bold text-blue-900">
              {t(
                'لم يتم إعداد حساب مدير عام على هذا الخادم بعد. يرجى إنشاء حساب المالك الخاص بك الآن للبدء بأمان.',
                'No General Manager account is set up on this server yet. Please create your owner account now to start securely.'
              )}
            </div>
          )}

          {typeof navigator !== 'undefined' && navigator.onLine === false && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 text-xs font-bold text-amber-900 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-700 mt-0.5" />
              <span className="leading-relaxed">
                {t(
                  'أنت الآن في وضع العمل دون إنترنت: يُسمح بتسجيل الدخول محلياً فقط للحسابات التي سبق التحقق منها بنجاح على هذا الجهاز، وسيتم إعادة التحقق من الصلاحيات فور عودة الاتصال بالسيرفر المركزي.',
                  'You are currently offline: local sign-in is only allowed for accounts previously verified on this device. Permissions will be re-verified once connection to the central server is restored.'
                )}
              </span>
            </div>
          )}

          {infoNotice && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-blue-50 border border-blue-200 text-xs font-bold text-blue-900">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-blue-700" />
              <span>{t(infoNotice)}</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs font-bold text-red-700 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{t(error)}</span>
            </div>
          )}

          {!needsAdminSetup && savedAccounts.length > 0 && (
            <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-900 dark:text-[#F3F7FC] flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-blue-800 dark:text-[#85B8FF]" />
                  <span>{t(`الحسابات المحفوظة على الجهاز (${savedAccounts.length})`, `Saved Accounts on Device (${savedAccounts.length})`)}</span>
                </span>
                <span className="text-[10px] font-bold text-slate-500 dark:text-[#97AECE]">
                  {t('تبديل ودخول سريع آمن', 'Fast & Secure Switch')}
                </span>
              </div>
              <div className="divide-y divide-slate-200 dark:divide-[#1B2F52] border border-slate-200 dark:border-[#21375C] rounded-md bg-white dark:bg-[#0E1C36] max-h-40 overflow-y-auto">
                {savedAccounts.map((acc) => {
                  const isResuming = resumingUserId === acc.userId;
                  const quickReady = acc.sessionStatus === 'active' && Boolean(acc.refreshToken || acc.accessToken);
                  return (
                    <div
                      key={acc.userId}
                      className="px-2 py-1.5 flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {acc.avatarPhoto ? (
                          <img
                            src={acc.avatarPhoto}
                            alt={acc.fullName}
                            className="w-8 h-8 rounded-lg object-cover border border-slate-200 shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-blue-900 text-white font-black text-xs flex items-center justify-center shrink-0">
                            {(acc.fullName || acc.username || '?').trim().charAt(0)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs truncate">
                            <span className="font-black text-slate-900 dark:text-[#F3F7FC] truncate">{acc.fullName}</span>
                            <span className="text-slate-300">·</span>
                            <span className="text-[10px] font-bold text-blue-800 dark:text-[#85B8FF] shrink-0">
                              {getRoleBadgeText(acc.role, t)}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 dark:text-[#97AECE] font-mono truncate">
                            @{acc.username}
                            {acc.shopName ? ` · ${acc.shopName}` : ''}
                            {quickReady ? ` · ${t('جلسة جاهزة', 'Session Ready')}` : ` · ${t('يتطلب كلمة المرور', 'Password Required')}`}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={Boolean(resumingUserId)}
                          onClick={() => handleResumeSavedAccount(acc)}
                          className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-black flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
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
                          <span>{isResuming ? t('جاري...', 'Loading...') : quickReady ? t('دخول', 'Enter') : t('تحديد', 'Select')}</span>
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(resumingUserId)}
                          onClick={() => setAccountToForget(acc)}
                          className="min-h-[32px] min-w-[32px] rounded-lg bg-red-50 hover:bg-red-100 text-red-700 flex items-center justify-center cursor-pointer"
                          title={t('إزالة الحساب من الجهاز', 'Remove account from device')}
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
            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#EEF3FA] dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#21375C]">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('login');
                  setError(null);
                  setInfoNotice(null);
                }}
                className={`h-8 px-2 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  authMode === 'login'
                    ? 'bg-[var(--awlad-navy-900)] dark:bg-[#1659C8] text-white font-black'
                    : 'text-slate-700 dark:text-[#A9BCD9] hover:bg-white dark:hover:bg-[#1A3461]'
                }`}
              >
                {t('تسجيل الدخول', 'Sign In')}
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
                className={`h-8 px-2 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  authMode === 'register_customer'
                    ? 'bg-[var(--awlad-navy-900)] dark:bg-[#1659C8] text-white font-black'
                    : 'text-slate-700 dark:text-[#A9BCD9] hover:bg-white dark:hover:bg-[#1A3461]'
                }`}
              >
                {t('تسجيل عميل جديد', 'New Customer')}
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
                className={`h-8 px-2 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  authMode === 'register_rep'
                    ? 'bg-[var(--awlad-navy-900)] dark:bg-[#1659C8] text-white font-black'
                    : 'text-slate-700 dark:text-[#A9BCD9] hover:bg-white dark:hover:bg-[#1A3461]'
                }`}
              >
                {t('تسجيل مندوب جديد', 'New Representative')}
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-2">
            {needsAdminSetup && (
              <>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">
                    {t('اسم الشركة / النشاط (اختياري):', 'Company / Business Name (Optional):')}
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder={t('أدخل اسم الشركة أو المؤسسة', 'Enter company or business name')}
                    className="w-full h-8 sm:h-9 rounded-md border border-slate-300 dark:border-[#2A436E] dark:bg-[#10203D] dark:text-[#F3F7FC] px-2.5 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all text-start"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">
                    {t('الاسم الكامل للمالك / المدير:', 'Owner / Manager Full Name:')}
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={t('أدخل الاسم الكامل للمالك أو المدير العام', 'Enter owner or general manager full name')}
                    className="w-full h-8 sm:h-9 rounded-md border border-slate-300 dark:border-[#2A436E] dark:bg-[#10203D] dark:text-[#F3F7FC] px-2.5 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all text-start"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">
                    {t('رقم الهاتف (اختياري):', 'Phone Number (Optional):')}
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="01xxxxxxxxx"
                    className="w-full h-8 sm:h-9 rounded-md border border-slate-300 dark:border-[#2A436E] dark:bg-[#10203D] dark:text-[#F3F7FC] px-2.5 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all text-start"
                  />
                </div>
              </>
            )}

            {!needsAdminSetup && (authMode === 'register_customer' || authMode === 'register_rep') && (
              <div className="space-y-1.5 p-2.5 rounded-lg bg-blue-50/60 dark:bg-[#132544] border border-blue-200/80 dark:border-[#21375C]">
                <p className="text-xs font-black text-blue-950 dark:text-[#85B8FF]">
                  {authMode === 'register_customer'
                    ? t('بيانات العميل الجديد (تُفعّل مباشرة للدخول والطلب)', 'New Customer Details (Activated immediately for ordering)')
                    : t('بيانات المندوب الجديد (تُفعّل مباشرة مع مخزن سيارة خاص)', 'New Representative Details (Activated with dedicated van warehouse)')}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('الاسم الكامل *', 'Full Name *')}</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder={authMode === 'register_customer' ? t('اسم العميل أو المسؤول', 'Customer or contact name') : t('اسم المندوب الثلاثي', 'Representative full name')}
                      className="w-full h-8 rounded-md border border-slate-300 bg-white dark:bg-[#10203D] dark:border-[#2A436E] dark:text-[#F3F7FC] px-2 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 outline-hidden text-start"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('رقم الهاتف *', 'Phone Number *')}</label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="01xxxxxxxxx"
                      className="w-full h-8 rounded-md border border-slate-300 bg-white dark:bg-[#10203D] dark:border-[#2A436E] dark:text-[#F3F7FC] px-2 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 outline-hidden text-start"
                    />
                  </div>
                  {authMode === 'register_customer' ? (
                    <>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('اسم المحل / النشاط', 'Shop / Business Name')}</label>
                        <input
                          type="text"
                          value={shopName}
                          onChange={(e) => setShopName(e.target.value)}
                          placeholder={t('مثال: سوبر ماركت النور', 'e.g., Al-Noor Supermarket')}
                          className="w-full h-8 rounded-md border border-slate-300 bg-white dark:bg-[#10203D] dark:border-[#2A436E] dark:text-[#F3F7FC] px-2 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 outline-hidden text-start"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('المحافظة', 'Governorate')}</label>
                        <input
                          type="text"
                          value={governorate}
                          onChange={(e) => setGovernorate(e.target.value)}
                          placeholder={t('مثال: القاهرة / الجيزة', 'e.g., Cairo / Giza')}
                          className="w-full h-8 rounded-md border border-slate-300 bg-white dark:bg-[#10203D] dark:border-[#2A436E] dark:text-[#F3F7FC] px-2 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 outline-hidden text-start"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('المنطقة', 'Area / District')}</label>
                        <input
                          type="text"
                          value={area}
                          onChange={(e) => setArea(e.target.value)}
                          placeholder={t('مثال: شبرا / المعادي', 'e.g., Shubra / Maadi')}
                          className="w-full h-8 rounded-md border border-slate-300 bg-white dark:bg-[#10203D] dark:border-[#2A436E] dark:text-[#F3F7FC] px-2 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 outline-hidden text-start"
                        />
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('رقم السيارة / الخط', 'Vehicle / Route No.')}</label>
                      <input
                        type="text"
                        value={vehicleNumber}
                        onChange={(e) => setVehicleNumber(e.target.value)}
                        placeholder={t('مثال: أ ب ج 1234', 'e.g., ABC 1234')}
                        className="w-full h-8 rounded-md border border-slate-300 bg-white dark:bg-[#10203D] dark:border-[#2A436E] dark:text-[#F3F7FC] px-2 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 outline-hidden text-start"
                      />
                    </div>
                  )}
                  <div className={authMode === 'register_customer' ? 'sm:col-span-2' : ''}>
                    <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('العنوان', 'Address')}</label>
                    <div className="flex flex-wrap gap-1.5">
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder={t('العنوان التفصيلي', 'Detailed Address')}
                        className="flex-1 min-w-[160px] h-8 rounded-md border border-slate-300 bg-white dark:bg-[#10203D] dark:border-[#2A436E] dark:text-[#F3F7FC] px-2 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-[var(--awlad-royal-700)] outline-hidden text-start"
                      />
                      {authMode === 'register_customer' && (
                        <button
                          type="button"
                          onClick={() => setShowLocationPicker(true)}
                          className="h-8 px-2.5 rounded-md bg-[var(--awlad-royal-700)] hover:bg-[var(--awlad-royal-600)] text-white text-xs font-black flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                          <span>{latitude !== undefined ? t('تعديل الموقع على الخريطة', 'Edit Map Location') : t('تحديد الموقع على الخريطة', 'Pin Location on Map')}</span>
                        </button>
                      )}
                    </div>
                    {authMode === 'register_customer' && latitude !== undefined && longitude !== undefined && (
                      <p className="text-[11px] font-bold text-emerald-700 mt-1" dir="ltr">
                        {t('تم تحديد الموقع:', 'Location set:')} {latitude.toFixed(5)}, {longitude.toFixed(5)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">
                {t('اسم المستخدم (أو رقم الهاتف):', 'Username (or Phone Number):')}
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('أدخل اسم المستخدم', 'Enter username')}
                  className="w-full h-8 sm:h-9 rounded-md border border-slate-300 dark:border-[#2A436E] dark:bg-[#10203D] dark:text-[#F3F7FC] ps-8 pe-2.5 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all text-start"
                />
                <User className="w-3.5 h-3.5 text-slate-400 absolute start-2.5 top-2.5 pointer-events-none" />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-0.5">
                <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9]">
                  {t('كلمة المرور:', 'Password:')}
                </label>
                {!needsAdminSetup && (
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(true)}
                    className="text-[11px] font-semibold text-blue-700 dark:text-[#85B8FF] hover:text-blue-900 transition-colors cursor-pointer"
                  >
                    {t('نسيت كلمة المرور؟', 'Forgot password?')}
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
                  placeholder={t('أدخل كلمة المرور', 'Enter password')}
                  className="w-full h-8 sm:h-9 rounded-md border border-slate-300 dark:border-[#2A436E] dark:bg-[#10203D] dark:text-[#F3F7FC] ps-8 pe-8 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all text-start"
                />
                <Lock className="w-3.5 h-3.5 text-slate-400 absolute start-2.5 top-2.5 pointer-events-none" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute end-2.5 top-2 text-slate-400 hover:text-slate-600 focus:outline-hidden cursor-pointer"
                  title={showPassword ? t('إخفاء كلمة المرور', 'Hide password') : t('إظهار كلمة المرور', 'Show password')}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {(needsAdminSetup || authMode === 'register_customer' || authMode === 'register_rep') && (
              <div>
                <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">
                  {t('تأكيد كلمة المرور:', 'Confirm Password:')}
                </label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('أعد إدخال كلمة المرور', 'Re-enter password')}
                  className="w-full h-8 sm:h-9 rounded-md border border-slate-300 dark:border-[#2A436E] dark:bg-[#10203D] dark:text-[#F3F7FC] px-2.5 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all text-start"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full min-h-[36px] py-2 px-3 bg-[var(--awlad-royal-700)] hover:bg-[var(--awlad-royal-600)] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white font-bold text-xs rounded-lg shadow-sm transition-all active:scale-98 disabled:opacity-60 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {needsAdminSetup || authMode !== 'login' ? (
                <UserPlus className="w-4 h-4" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              <span>
                {isLoading
                  ? t('جاري التحقق والمصادقة...', 'Authenticating...')
                  : needsAdminSetup
                  ? t('إنشاء حساب المدير العام والدخول', 'Create Admin Account & Sign In')
                  : authMode === 'register_customer'
                  ? t('إنشاء حساب العميل والدخول', 'Create Customer Account & Sign In')
                  : authMode === 'register_rep'
                  ? t('إنشاء حساب المندوب والدخول', 'Create Rep Account & Sign In')
                  : t('دخول النظام', 'Sign In')}
              </span>
            </button>
          </form>
        </div>

        <div className="bg-slate-50 dark:bg-[#0A162B] border-t border-slate-100 dark:border-[#21375C] px-3 py-2 text-center text-[11px] text-slate-500 dark:text-[#97AECE] font-medium">
          {t('مؤسسة أولاد سليم لتجارة المواد الغذائية بالجملة • جميع الحقوق محفوظة 2026', 'Awlad Selim Wholesale Food Trading • All Rights Reserved 2026')}
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-950/70 dark:bg-[#040B17]/80 backdrop-blur-xs">
          <div dir={dir} className="w-full max-w-sm bg-white dark:bg-[#0E1C36] rounded-lg p-3.5 text-start shadow-2xl border border-slate-200 dark:border-[#21375C]">
            <h4 className="text-sm font-bold text-slate-900 dark:text-[#F3F7FC] mb-1">{t('استعادة كلمة المرور', 'Password Recovery')}</h4>
            <p className="text-xs text-slate-600 dark:text-[#A9BCD9] leading-relaxed mb-2.5">
              {t(
                'لأسباب أمنية، يتم إعادة ضبط كلمات المرور حصرياً من خلال مسؤول النظام داخل إدارة المستخدمين.',
                'For security reasons, passwords can only be reset by a system administrator in User Management.'
              )}
            </p>
            <button
              onClick={() => setShowForgotModal(false)}
              className="w-full h-8 bg-[var(--awlad-navy-900)] dark:bg-[#1659C8] text-white text-xs font-bold rounded-md hover:bg-[var(--awlad-navy-950)] dark:hover:bg-[#1F6BE6] cursor-pointer"
            >
              {t('حسناً، فهمت', 'Got it')}
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

      <CustomerLocationPickerModal
        isOpen={showLocationPicker}
        onClose={() => setShowLocationPicker(false)}
        initialLat={latitude}
        initialLng={longitude}
        initialAddress={address}
        initialCity={city}
        initialArea={area}
        initialGovernorate={governorate}
        title={t('تحديد موقع المحل على الخريطة', 'Pin Shop Location on Map')}
        onConfirm={(picked: PickedCustomerLocation) => {
          setLatitude(picked.latitude);
          setLongitude(picked.longitude);
          if (picked.address) setAddress(picked.address);
          if (picked.city) setCity(picked.city);
          if (picked.area) setArea(picked.area);
          if (picked.governorate) setGovernorate(picked.governorate);
          setLocationCapturedAt(picked.locationCapturedAt);
        }}
      />

      <ConfirmDialog
        isOpen={Boolean(accountToForget)}
        onClose={() => setAccountToForget(null)}
        onConfirm={async () => {
          if (!accountToForget) return;
          const res = await removeSavedAccountFromDevice(accountToForget.userId);
          setAccountToForget(null);
          setInfoNotice(
            !res.serverRevoked && res.warning
              ? t(res.warning)
              : t(
                  'تمت إزالة الحساب من هذا الجهاز فقط دون التأثير على حساباتك الأخرى أو بيانات السيرفر.',
                  'Account removed from this device only without affecting other accounts or server data.'
                )
          );
        }}
        variant="danger"
        title={t('إزالة الحساب من الجهاز؟', 'Remove account from device?')}
        message={
          accountToForget
            ? t(
                `هل تريد إزالة الحساب (${accountToForget.fullName} - @${accountToForget.username}) من قائمة الحسابات المحفوظة على هذا الجهاز؟`,
                `Remove account (${accountToForget.fullName} - @${accountToForget.username}) from saved accounts on this device?`
              )
            : ''
        }
        confirmLabel={t('نعم، إزالة من الجهاز', 'Yes, Remove from Device')}
      />
    </div>
  );
};

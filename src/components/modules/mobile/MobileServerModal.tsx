import React, { useState, useEffect } from 'react';
import {
  Server,
  Wifi,
  CheckCircle2,
  AlertCircle,
  X,
  Radio,
  Globe,
  Cloud,
  Lock,
  QrCode,
  Search,
  Loader2,
} from 'lucide-react';
import {
  detectModeFromUrl,
  getConfiguredApiBaseUrl,
  getConnectionModeLabel,
  getStoredConnectionProfiles,
  resolveModeEndpointUrl,
  saveFallbackEndpoints,
  saveStoredConnectionProfiles,
  setConfiguredApiBaseUrl,
  testServerHealth,
  validateConnectionUrl,
} from '../../../services/api';
import {
  claimPairingInvitation,
  discoverServerCandidates,
  type DiscoveredServerCandidate,
} from '../../../services/discovery';
import { useAuth } from '../../../context/AuthContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import { isNativeCapacitor } from '../../../services/native';
import { QrScannerModal } from '../../common/QrScannerModal';
import type { ConnectionMode, ConnectionProfilesConfig } from '../../../types';

interface MobileServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const MODE_OPTIONS: Array<{
  key: ConnectionMode;
  shortLabel: string;
  shortLabelEn: string;
  title: string;
  titleEn: string;
  hint: string;
  hintEn: string;
  icon: React.ElementType;
  placeholder: string;
}> = [
  {
    key: 'local_network',
    shortLabel: 'الشبكة المحلية',
    shortLabelEn: 'Local Network',
    title: 'الشبكة المحلية (IP + 3000)',
    titleEn: 'Local Network (IP + 3000)',
    hint: 'الاتصال المباشر بلابتوب المحل عبر شبكة الواي فاي المحلية (http://IP:3000).',
    hintEn: 'Direct connection to the store laptop over local Wi-Fi (http://IP:3000).',
    icon: Wifi,
    placeholder: '',
  },
  {
    key: 'free_remote',
    shortLabel: 'رابط مجاني',
    shortLabelEn: 'Free Remote',
    title: 'رابط عن بُعد مجاني (Quick Tunnel)',
    titleEn: 'Free Remote (Quick Tunnel)',
    hint: 'رابط Cloudflare Quick Tunnel المجاني بصيغة https://...',
    hintEn: 'Free Cloudflare Quick Tunnel HTTPS URL.',
    icon: Radio,
    placeholder: '',
  },
  {
    key: 'pro_remote',
    shortLabel: 'دومين احترافي',
    shortLabelEn: 'Pro Domain',
    title: 'دومين احترافي (Named Tunnel)',
    titleEn: 'Pro Remote (Named Tunnel)',
    hint: 'دومين ثابت بشهادة HTTPS مشفرة دون تغيير مع إعادة التشغيل.',
    hintEn: 'Static domain with encrypted HTTPS that persists across restarts.',
    icon: Globe,
    placeholder: '',
  },
  {
    key: 'cloud_vps',
    shortLabel: 'Cloud VPS',
    shortLabelEn: 'Cloud VPS',
    title: 'اتصال الخادم السحابي (Cloud VPS)',
    titleEn: 'Cloud VPS Connection',
    hint: 'سيرفر سحابي دائم متصل بنفس قاعدة البيانات المركزية.',
    hintEn: 'Always-on cloud server connected to the same central database.',
    icon: Cloud,
    placeholder: '',
  },
];

export const MobileServerModal: React.FC<MobileServerModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const { setPairingBanner } = useAuth();
  const { t, dir } = usePreferences();
  const [profiles, setProfiles] = useState<ConnectionProfilesConfig>(() =>
    getStoredConnectionProfiles()
  );
  const [selectedMode, setSelectedMode] = useState<ConnectionMode>(() =>
    detectModeFromUrl(getConfiguredApiBaseUrl(), getStoredConnectionProfiles())
  );
  const [useSameOrigin, setUseSameOrigin] = useState<boolean>(
    () => !isNativeCapacitor() && !getConfiguredApiBaseUrl()
  );
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredServerCandidate[]>([]);
  const [discoveryNotice, setDiscoveryNotice] = useState<string | null>(null);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [claimingQr, setClaimingQr] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    ok?: boolean;
    message?: string;
    lanUrls?: string[];
    httpsActive?: boolean;
  }>({});

  const nativeApp = isNativeCapacitor();

  useEffect(() => {
    if (isOpen) {
      const stored = getStoredConnectionProfiles();
      const currentUrl = getConfiguredApiBaseUrl();
      setProfiles(stored);
      setSelectedMode(detectModeFromUrl(currentUrl, stored));
      setUseSameOrigin(!nativeApp && !currentUrl);
      setFormError(null);
      setTestResult({});
      setDiscoveryNotice(null);
    }
  }, [isOpen, nativeApp]);

  useEffect(() => {
    if (!isOpen || showQrScanner) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, showQrScanner, onClose]);

  const handleAutoDiscover = async () => {
    setFormError(null);
    setDiscoveryNotice(null);
    setDiscovering(true);
    try {
      const results = await discoverServerCandidates();
      setDiscoveredServers(results);
      if (results.length === 0) {
        setDiscoveryNotice(t('لم يتم العثور على سيرفر يعمل على الشبكة الحالية تلقائياً. تأكد من الاتصال بنفس Wi-Fi أو استخدم رابط QR.', 'No running server was auto-discovered on the current network. Make sure you are on the same Wi-Fi or use a QR link.'));
      } else {
        setDiscoveryNotice(t(`تم اكتشاف (${results.length}) عنوان سيرفر متاح. اضغط على أي عنوان لتطبيقه فوراً.`, `Discovered ${formatLocaleNumber(results.length)} available server(s). Tap any address to apply immediately.`));
      }
    } finally {
      setDiscovering(false);
    }
  };

  const handleSelectDiscovered = async (candidate: DiscoveredServerCandidate) => {
    setFormError(null);
    if (candidate.profiles) {
      saveStoredConnectionProfiles(candidate.profiles);
      setProfiles(candidate.profiles);
    }
    if (Array.isArray(candidate.fallbackEndpoints)) {
      saveFallbackEndpoints(candidate.fallbackEndpoints);
    }
    const mode = detectModeFromUrl(candidate.url, candidate.profiles || profiles);
    setSelectedMode(mode);
    setUseSameOrigin(false);
    setConfiguredApiBaseUrl(candidate.url);
    onClose();
    await onSaved();
  };

  const handleQrDetected = async (rawText: string) => {
    setShowQrScanner(false);
    setFormError(null);
    setClaimingQr(true);
    const res = await claimPairingInvitation(rawText, { clearExistingAuth: true });
    setClaimingQr(false);
    if (!res.ok) {
      setFormError(res.error ? t(res.error) : t('تعذر ربط الجهاز عبر الرمز المدخل', 'Unable to pair device using the entered code'));
      return;
    }
    setPairingBanner({
      type: res.requiresAdminApproval ? 'warning' : 'success',
      message: res.requiresAdminApproval
        ? t(`تم إعداد السيرفر (${res.companyName || ''}). هذا الجهاز بانتظار موافقة مدير النظام، وبعدها يمكنك تسجيل الدخول بحسابك.`, `Server (${res.companyName || ''}) configured. This device is awaiting admin approval before you can sign in.`)
        : t(`تم ربط الجهاز بسيرفر (${res.companyName || ''}) بنجاح (${res.endpointUrl}). أدخل اسم المستخدم وكلمة المرور للدخول.`, `Device paired with (${res.companyName || ''}) (${res.endpointUrl}). Enter your username and password to sign in.`),
    });
    onClose();
    await onSaved();
  };

  if (!isOpen) return null;

  const activeModeMeta = MODE_OPTIONS.find((m) => m.key === selectedMode) || MODE_OPTIONS[0];
  const resolvedCandidateUrl = useSameOrigin
    ? ''
    : resolveModeEndpointUrl(selectedMode, profiles);

  const handleTest = async () => {
    setFormError(null);
    setTestResult({});

    if (!useSameOrigin) {
      const check = validateConnectionUrl(
        selectedMode,
        resolvedCandidateUrl,
        profiles.enforceHttpsForRemote !== false
      );
      if (!check.valid) {
        setFormError(check.error ? t(check.error) : t('عنوان السيرفر غير صالح', 'Invalid server address'));
        return;
      }
    }

    setTesting(true);
    const res = await testServerHealth(resolvedCandidateUrl);
    setTesting(false);
    if (res.ok) {
      setTestResult({
        ok: true,
        httpsActive: res.httpsActive,
        message: `${t('متصل بالسيرفر المركزي', 'Connected to central server')} (${res.latencyMs}ms)${res.httpsActive ? ` • ${t('HTTPS مشفر', 'Encrypted HTTPS')}` : ''}${res.version ? ` — ${t('إصدار', 'v')} ${res.version}` : ''}`,
        lanUrls: res.lanUrls,
      });
    } else {
      setTestResult({
        ok: false,
        message: res.error ? t(res.error) : t('تعذر الاتصال بالسيرفر', 'Unable to connect to server'),
      });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (useSameOrigin && !nativeApp) {
      const updatedProfiles: ConnectionProfilesConfig = {
        ...profiles,
        activeMode: selectedMode,
      };
      saveStoredConnectionProfiles(updatedProfiles);
      setConfiguredApiBaseUrl('');
      onClose();
      await onSaved();
      return;
    }

    const check = validateConnectionUrl(
      selectedMode,
      resolvedCandidateUrl,
      profiles.enforceHttpsForRemote !== false
    );
    if (!check.valid) {
      setFormError(check.error ? t(check.error) : t('يرجى التحقق من عنوان السيرفر', 'Please check the server URL'));
      return;
    }

    const updatedProfiles: ConnectionProfilesConfig = {
      ...profiles,
      activeMode: selectedMode,
      freeRemote:
        selectedMode === 'free_remote'
          ? { ...profiles.freeRemote, tunnelUrl: check.normalizedUrl }
          : profiles.freeRemote,
      proRemote:
        selectedMode === 'pro_remote'
          ? { ...profiles.proRemote, domainUrl: check.normalizedUrl }
          : profiles.proRemote,
      cloudVps:
        selectedMode === 'cloud_vps'
          ? { ...profiles.cloudVps, vpsUrl: check.normalizedUrl }
          : profiles.cloudVps,
    };

    saveStoredConnectionProfiles(updatedProfiles);
    setConfiguredApiBaseUrl(check.normalizedUrl);
    onClose();
    await onSaved();
  };

  return (
    <div
      dir={dir}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/65 backdrop-blur-xs"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSave}
        className="w-full max-w-lg bg-white dark:bg-[#0E1C36] rounded-t-xl sm:rounded-lg p-2.5 shadow-2xl border border-slate-200 dark:border-[#21375C] space-y-2 text-start pb-safe max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-blue-900" />
            <div>
              <h3 className="text-xs font-black text-slate-900">
                {t('إعداد الاتصال بالسيرفر المركزي (4 أوضاع)', 'Central Server Connection Setup (4 Modes)')}
              </h3>
              <p className="text-[10px] text-slate-500">
                {useSameOrigin
                  ? t('الوضع الحالي: الخادم المحلي المباشر (Same-Origin)', 'Current mode: Direct Local Server (Same-Origin)')
                  : `${t('الوضع المحدد:', 'Selected mode:')} ${t(getConnectionModeLabel(selectedMode))}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('إغلاق', 'Close')}
            className="h-8 w-8 flex items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Smart Auto-Discovery & QR Pairing Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={claimingQr}
            onClick={() => setShowQrScanner(true)}
            className="h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#011E58] text-white text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {claimingQr ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
            <span>{claimingQr ? t('جاري الربط...', 'Pairing...') : t('مسح QR أو لصق رابط دعوة', 'Scan QR or Paste Invite Link')}</span>
          </button>
          <button
            type="button"
            disabled={discovering}
            onClick={handleAutoDiscover}
            className="h-8 px-2.5 rounded-md bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {discovering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            <span>{discovering ? t('جاري البحث في الشبكة...', 'Scanning network...') : t('اكتشاف السيرفر تلقائياً', 'Auto-Discover Server')}</span>
          </button>
        </div>

        {discoveryNotice && (
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5">
            <div className="text-[11px] font-bold text-slate-700">{discoveryNotice}</div>
            {discoveredServers.length > 0 && (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 bg-white overflow-hidden">
                {discoveredServers.map((srv) => (
                  <button
                    key={srv.url}
                    type="button"
                    onClick={() => handleSelectDiscovered(srv)}
                    className="w-full px-2.5 py-2 hover:bg-[#EEF3FA] flex items-center justify-between gap-2 text-start cursor-pointer"
                  >
                    <div>
                      <div className="text-xs font-black text-slate-900">{srv.companyName || 'AWLAD SELIM Server'}</div>
                      <div className="text-[11px] font-mono text-[#003589]" dir="ltr">{srv.url}</div>
                    </div>
                    <span className="text-[10px] font-mono text-[#011E58] font-bold">
                      {srv.latencyMs}ms
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 4-Mode Switcher Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {MODE_OPTIONS.map((mode) => {
            const ModeIcon = mode.icon;
            const active = !useSameOrigin && selectedMode === mode.key;
            return (
              <button
                key={mode.key}
                type="button"
                onClick={() => {
                  setUseSameOrigin(false);
                  setSelectedMode(mode.key);
                  setFormError(null);
                  setTestResult({});
                }}
                className={`p-1.5 rounded-md border text-center transition-all cursor-pointer flex flex-col items-center gap-0.5 ${
                  active
                    ? 'bg-blue-900 text-white border-blue-900'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
                }`}
              >
                <ModeIcon className="w-3.5 h-3.5" />
                <span className="text-[11px] font-bold">{t(mode.shortLabel, mode.shortLabelEn)}</span>
              </button>
            );
          })}
        </div>

        {!nativeApp && (
          <label className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={useSameOrigin}
              onChange={(e) => {
                setUseSameOrigin(e.target.checked);
                setFormError(null);
                setTestResult({});
              }}
              className="w-3.5 h-3.5 rounded text-blue-900"
            />
            <span>{t('اتصال تلقائي بنفس السيرفر المفتوح منه البرنامج (Same-Origin)', 'Auto-connect to current origin server (Same-Origin)')}</span>
          </label>
        )}

        {!useSameOrigin && (
          <div className="space-y-1.5 bg-slate-50/70 p-2 rounded-lg border border-slate-200">
            <div className="text-xs font-black text-slate-900">{t(activeModeMeta.title, activeModeMeta.titleEn)}</div>
            <p className="text-[11px] text-slate-600 leading-snug">{t(activeModeMeta.hint, activeModeMeta.hintEn)}</p>

            {selectedMode === 'local_network' ? (
              <div className="space-y-1.5">
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="col-span-2">
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                      {t('عنوان IP اللابتوب:', 'Host IP Address:')}
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={profiles.localNetwork.ip}
                      onChange={(e) => {
                        setProfiles((prev) => ({
                          ...prev,
                          localNetwork: { ...prev.localNetwork, ip: e.target.value },
                        }));
                        setFormError(null);
                        setTestResult({});
                      }}
                      placeholder=""
                      className="w-full h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-mono text-left focus:border-blue-600 outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
                      {t('المنفذ (Port):', 'Port:')}
                    </label>
                    <input
                      type="number"
                      dir="ltr"
                      min={1}
                      max={65535}
                      value={profiles.localNetwork.port}
                      onChange={(e) => {
                        setProfiles((prev) => ({
                          ...prev,
                          localNetwork: {
                            ...prev.localNetwork,
                            port: parseInt(e.target.value, 10) || 3000,
                          },
                        }));
                        setFormError(null);
                        setTestResult({});
                      }}
                      className="w-full h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-mono text-left focus:border-blue-600 outline-hidden"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setProfiles((prev) => ({
                        ...prev,
                        localNetwork: { ...prev.localNetwork, ip: '192.168.1.100', port: 3000 },
                      }))
                    }
                    className="px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-700 text-[11px] font-mono cursor-pointer"
                  >
                    192.168.1.100:3000
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setProfiles((prev) => ({
                        ...prev,
                        localNetwork: { ...prev.localNetwork, ip: '10.0.2.2', port: 3000 },
                      }))
                    }
                    className="px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-700 text-[11px] font-mono cursor-pointer"
                  >
                    10.0.2.2:3000 ({t('محاكي', 'Emulator')})
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-slate-700">
                  {t('رابط الاتصال الآمن (HTTPS):', 'Secure Connection URL (HTTPS):')}
                </label>
                <input
                  type="url"
                  dir="ltr"
                  value={
                    selectedMode === 'free_remote'
                      ? profiles.freeRemote.tunnelUrl
                      : selectedMode === 'pro_remote'
                      ? profiles.proRemote.domainUrl
                      : profiles.cloudVps.vpsUrl
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    setProfiles((prev) => ({
                      ...prev,
                      freeRemote:
                        selectedMode === 'free_remote'
                          ? { ...prev.freeRemote, tunnelUrl: val }
                          : prev.freeRemote,
                      proRemote:
                        selectedMode === 'pro_remote'
                          ? { ...prev.proRemote, domainUrl: val }
                          : prev.proRemote,
                      cloudVps:
                        selectedMode === 'cloud_vps'
                          ? { ...prev.cloudVps, vpsUrl: val }
                          : prev.cloudVps,
                    }));
                    setFormError(null);
                    setTestResult({});
                  }}
                  placeholder={activeModeMeta.placeholder}
                  className="w-full h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-mono text-left focus:border-blue-600 outline-hidden"
                />
                {selectedMode === 'free_remote' && (
                  <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 font-bold">
                    {t('تنبيه: رابط Quick Tunnel المجاني مؤقت وقد يتغير عند إعادة تشغيل النفق على اللابتوب؛ يمكنك إعادة الربط فوراً بالـ QR أو الرابط الجديد.', 'Note: Quick Tunnel URLs are temporary and may change when restarting the tunnel; you can re-pair immediately via QR or the new link.')}
                  </p>
                )}
                <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
                  <Lock className="w-3 h-3 text-emerald-700 shrink-0" />
                  <span>{t('يُشترط HTTPS لحماية جلسة الدخول والتوكنات عند الاتصال من خارج المحل.', 'HTTPS is required to protect login sessions and tokens when connecting remotely.')}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {formError && (
          <div className="p-2 rounded-md border bg-red-50 border-red-200 text-red-700 text-xs font-bold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{formError}</span>
          </div>
        )}

        {testResult.message && (
          <div
            className={`p-2 rounded-md border text-xs font-bold space-y-1 ${
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
              <div className="flex flex-wrap gap-1 pt-1" dir="ltr">
                {testResult.lanUrls.map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => {
                      const clean = u.replace(/^https?:\/\//i, '');
                      const [host, p] = clean.split(':');
                      setUseSameOrigin(false);
                      setSelectedMode('local_network');
                      setProfiles((prev) => ({
                        ...prev,
                        localNetwork: {
                          ...prev.localNetwork,
                          ip: host || prev.localNetwork.ip,
                          port: parseInt(p || '3000', 10) || 3000,
                        },
                      }));
                    }}
                    className="px-2 py-0.5 rounded bg-white border border-emerald-300 text-[10px] font-mono text-emerald-800 cursor-pointer"
                  >
                    {u}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-1.5 pt-1">
          <button
            type="button"
            disabled={testing}
            onClick={handleTest}
            className="h-8 px-2.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>{testing ? t('جاري الفحص...', 'Testing...') : t('اختبار الاتصال', 'Test Connection')}</span>
          </button>
          <button
            type="submit"
            className="h-8 flex-1 rounded-md bg-[#011E58] hover:bg-[#001A49] text-white text-xs font-black cursor-pointer"
          >
            {t('حفظ وتطبيق الوضع', 'Save & Apply Mode')}
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

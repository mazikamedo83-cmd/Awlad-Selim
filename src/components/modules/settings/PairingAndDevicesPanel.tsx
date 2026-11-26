import React, { useCallback, useEffect, useState } from 'react';
import {
  QrCode,
  Link2,
  Copy,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Monitor,
  Smartphone,
  Globe,
  Send,
  Trash2,
  Clock,
  Share2,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import {
  apiRequest,
  getConnectionModeLabel,
  getStoredConnectionProfiles,
  resolvePairingEndpointForMode,
  validateConnectionUrl,
} from '../../../services/api';
import { isNativeCapacitor, saveAndShareDocument } from '../../../services/native';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDateTime } from '../../../i18n/translator';
import { QrCodeDisplay } from '../../common/QrCodeDisplay';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';
import type {
  ConnectionMode,
  ConnectionProfilesConfig,
  PairedDevice,
  PairedDevicesSummary,
  PairingCreateResponse,
  PairingTokenRecord,
  User,
} from '../../../types';

interface PairingAndDevicesPanelProps {
  users: User[];
  activeMode: ConnectionMode;
  activeEndpoint: string;
  profiles?: ConnectionProfilesConfig;
  onShowToast: (msg: string) => void;
}

const DEFAULT_SUMMARY: PairedDevicesSummary = {
  total: 0,
  active: 0,
  pendingApproval: 0,
  revoked: 0,
  onlineNow: 0,
};

function deviceTypeLabel(type: string, t: (ar: string, en?: string) => string): string {
  switch (type) {
    case 'windows':
      return 'Windows';
    case 'android':
      return 'Android';
    case 'ios':
      return 'iPhone / iOS';
    default:
      return t('متصفح ويب', 'Web Browser');
  }
}

function DevicePlatformIcon({ type }: { type: string }) {
  if (type === 'windows') return <Monitor className="w-4 h-4 text-blue-800" />;
  if (type === 'android' || type === 'ios') return <Smartphone className="w-4 h-4 text-[#003589]" />;
  return <Globe className="w-4 h-4 text-slate-600" />;
}

export const PairingAndDevicesPanel: React.FC<PairingAndDevicesPanelProps> = ({
  users,
  activeMode,
  activeEndpoint,
  profiles,
  onShowToast,
}) => {
  const { t } = usePreferences();
  const [tokens, setTokens] = useState<PairingTokenRecord[]>([]);
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [summary, setSummary] = useState<PairedDevicesSummary>(DEFAULT_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create Pairing Form
  const [targetUserId, setTargetUserId] = useState('');
  const [targetDeviceType, setTargetDeviceType] = useState<'any' | 'windows' | 'android' | 'ios'>('any');
  const [connectionMode, setConnectionMode] = useState<'auto' | ConnectionMode>('auto');
  const [ttlMinutes, setTtlMinutes] = useState<number>(60);
  const [singleUse, setSingleUse] = useState<boolean>(true);
  const [requireAdminApproval, setRequireAdminApproval] = useState<boolean>(false);
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);

  // Created Invite / QR Card
  const [createdInvite, setCreatedInvite] = useState<PairingCreateResponse | null>(null);

  // Actions state
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deviceToRevoke, setDeviceToRevoke] = useState<PairedDevice | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tokRes, devRes] = await Promise.all([
        apiRequest<{ ok: boolean; tokens: PairingTokenRecord[] }>('/api/admin/pairing/tokens'),
        apiRequest<{ ok: boolean; devices: PairedDevice[]; summary: PairedDevicesSummary }>('/api/admin/devices'),
      ]);
      setTokens(Array.isArray(tokRes.tokens) ? tokRes.tokens : []);
      setDevices(Array.isArray(devRes.devices) ? devRes.devices : []);
      setSummary(devRes.summary || DEFAULT_SUMMARY);
    } catch (err: any) {
      setError(err?.message || t('تعذر تحميل قائمة الأجهزة وروابط الربط', 'Failed to load paired devices and pairing tokens'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const effectiveProfiles = profiles || getStoredConnectionProfiles();
  const autoPairingTarget = resolvePairingEndpointForMode({
    selectedMode: 'auto',
    activeMode,
    profiles: effectiveProfiles,
    activeEndpoint,
  });
  const pairingTarget = resolvePairingEndpointForMode({
    selectedMode: connectionMode,
    activeMode,
    profiles: effectiveProfiles,
    activeEndpoint,
  });
  const targetUrlValidation = validateConnectionUrl(
    pairingTarget.effectiveMode,
    pairingTarget.endpointUrl,
    effectiveProfiles.enforceHttpsForRemote !== false
  );

  const handleCreatePairing = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!targetUrlValidation.valid || !targetUrlValidation.normalizedUrl) {
      setError(
        targetUrlValidation.error ||
          t(
            'عنوان السيرفر المختار غير صالح لإنشاء رابط الربط. يرجى ضبط عنوان الوضع المختار أولاً.',
            'Selected server URL is invalid for creating a pairing link. Please configure the mode URL first.'
          )
      );
      return;
    }
    setCreating(true);
    try {
      const res = await apiRequest<PairingCreateResponse>('/api/admin/pairing/tokens', {
        method: 'POST',
        body: {
          targetUserId: targetUserId || undefined,
          targetDeviceType,
          connectionMode: pairingTarget.effectiveMode,
          ttlMinutes,
          singleUse,
          requireAdminApproval,
          notes,
          serverBaseUrl: targetUrlValidation.normalizedUrl,
        },
      });
      setCreatedInvite(res);
      setNotes('');
      onShowToast(t('تم إنشاء رابط الربط المباشر ورمز QR بنجاح', 'Direct pairing link & QR code generated successfully'));
      await loadAll();
    } catch (err: any) {
      setError(err?.message || t('تعذر إنشاء رابط الربط', 'Failed to create pairing link'));
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    setBusyId(tokenId);
    try {
      await apiRequest(`/api/admin/pairing/tokens/${tokenId}/revoke`, { method: 'POST' });
      onShowToast(t('تم إلغاء رابط الربط', 'Pairing link revoked'));
      await loadAll();
    } catch (err: any) {
      setError(err?.message || t('تعذر إلغاء الرابط', 'Failed to revoke link'));
    } finally {
      setBusyId(null);
    }
  };

  const handleApproveDevice = async (deviceId: string) => {
    setBusyId(deviceId);
    try {
      await apiRequest(`/api/admin/devices/${deviceId}/approve`, { method: 'POST' });
      onShowToast(t('تم اعتماد الجهاز وتفعيل صلاحية دخوله', 'Device approved and access enabled'));
      await loadAll();
    } catch (err: any) {
      setError(err?.message || t('تعذر اعتماد الجهاز', 'Failed to approve device'));
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmRevokeDevice = async () => {
    if (!deviceToRevoke) return;
    const targetId = deviceToRevoke.deviceId;
    setDeviceToRevoke(null);
    setBusyId(targetId);
    try {
      await apiRequest(`/api/admin/devices/${targetId}/revoke`, { method: 'POST' });
      onShowToast(t('تم فصل الجهاز وإلغاء جميع جلساته النشطة فوراً', 'Device disconnected and all active sessions revoked immediately'));
      await loadAll();
    } catch (err: any) {
      setError(err?.message || t('تعذر فصل الجهاز', 'Failed to revoke device'));
    } finally {
      setBusyId(null);
    }
  };

  const handleResendDeviceLink = async (device: PairedDevice) => {
    const validModes: ConnectionMode[] = ['local_network', 'free_remote', 'pro_remote', 'cloud_vps'];
    const hasValidDeviceMode = validModes.includes(device.connectionMode as ConnectionMode);
    const resendSelectedMode: 'auto' | ConnectionMode =
      connectionMode !== 'auto'
        ? connectionMode
        : hasValidDeviceMode
        ? (device.connectionMode as ConnectionMode)
        : 'auto';
    const resendTarget = resolvePairingEndpointForMode({
      selectedMode: resendSelectedMode,
      activeMode,
      profiles: effectiveProfiles,
      activeEndpoint,
    });
    const resendCheck = validateConnectionUrl(
      resendTarget.effectiveMode,
      resendTarget.endpointUrl,
      effectiveProfiles.enforceHttpsForRemote !== false
    );
    if (!resendCheck.valid || !resendCheck.normalizedUrl) {
      setError(
        resendCheck.error ||
          t(
            `عنوان السيرفر لوضع (${getConnectionModeLabel(resendTarget.effectiveMode)}) غير صالح لإعادة إرسال الرابط.`,
            `Server URL for mode (${getConnectionModeLabel(resendTarget.effectiveMode)}) is invalid for resending link.`
          )
      );
      return;
    }

    setError(null);
    setBusyId(device.deviceId);
    try {
      const res = await apiRequest<PairingCreateResponse>(
        `/api/admin/devices/${device.deviceId}/resend-link`,
        {
          method: 'POST',
          body: {
            connectionMode: resendTarget.effectiveMode,
            serverBaseUrl: resendCheck.normalizedUrl,
          },
        }
      );
      setCreatedInvite(res);
      onShowToast(t(`تم توليد رابط ربط جديد للجهاز (${device.deviceName})`, `Generated a new pairing link for device (${device.deviceName})`));
      await loadAll();
    } catch (err: any) {
      setError(err?.message || t('تعذر إعادة إنشاء رابط الربط', 'Failed to regenerate pairing link'));
    } finally {
      setBusyId(null);
    }
  };

  const copyText = (text: string, label: string) => {
    if (window.awladDesktop?.copyText) {
      window.awladDesktop.copyText(text);
    } else if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    onShowToast(t(`تم نسخ ${label}`, `Copied ${label}`));
  };

  const buildWhatsappText = (invite: PairingCreateResponse): string => {
    const modeTitle = getConnectionModeLabel(invite.tokenRecord.connectionMode);
    const target = invite.tokenRecord.targetUserName
      ? `\n${t('الحساب المخصص:', 'Assigned Account:')} ${invite.tokenRecord.targetUserName}`
      : '';
    return [
      t('دعوة ربط جهاز بنظام AWLAD SELIM (أولاد سليم):', 'AWLAD SELIM Device Pairing Invite:'),
      t(
        `اضغط على الرابط التالي لإعداد السيرفر تلقائياً على جهازك (${modeTitle}):`,
        `Tap the link below to automatically configure the server on your device (${modeTitle}):`
      ),
      invite.directInviteUrl,
      target,
      t(
        'ملاحظة: بعد فتح التطبيق سيُطلب منك تسجيل الدخول باسم المستخدم وكلمة المرور المعتادة.',
        'Note: After opening the app, you will be asked to sign in with your regular username and password.'
      ),
    ]
      .filter(Boolean)
      .join('\n');
  };

  const handleShareInvite = async (invite: PairingCreateResponse) => {
    const text = buildWhatsappText(invite);
    if (isNativeCapacitor() || (typeof navigator !== 'undefined' && (navigator as any).share)) {
      if (isNativeCapacitor()) {
        await saveAndShareDocument({
          filename: 'awlad-selim-invite.txt',
          content: text,
          mimeType: 'text/plain',
          title: t('رابط ربط جهاز — AWLAD SELIM', 'Device Pairing Link — AWLAD SELIM'),
        });
        return;
      }
      try {
        await (navigator as any).share({
          title: t('دعوة ربط جهاز — AWLAD SELIM', 'Device Pairing Invite — AWLAD SELIM'),
          text,
          url: invite.directInviteUrl,
        });
        return;
      } catch {
        // fallback to clipboard
      }
    }
    copyText(text, t('رسالة الدعوة المباشرة', 'Direct Invite Message'));
  };

  const activeUsers = users.filter((u) => u.isActive);

  return (
    <div className="space-y-2 text-xs">
      {error && (
        <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-700 font-bold flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 1. Direct Invite Link & QR Code Pairing Generator */}
      <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-1.5">
          <div>
            <h3 className="text-xs sm:text-sm font-black text-slate-900 flex items-center gap-1.5">
              <QrCode className="w-4 h-4 text-[#003589]" />
              <span>{t('الربط الذكي للأجهزة (رابط دعوة مباشر + QR Code)', 'Smart Device Pairing (Direct Invite Link + QR Code)')}</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {t(
                'يُعدّ عنوان السيرفر تلقائياً على Android و iPhone و Windows ويفتح شاشة تسجيل الدخول المعتادة — لا تُضمَّن أي كلمات مرور أو أسرار في الرابط.',
                'Automatically configures the server URL on Android, iPhone, and Windows and opens the regular login screen — no passwords or secrets are included in the link.'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={loadAll}
            disabled={loading}
            className="h-7 px-2 rounded-md text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center gap-1 cursor-pointer self-start"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>{t('تحديث السجلات', 'Refresh Records')}</span>
          </button>
        </div>

        <form onSubmit={handleCreatePairing} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
          <div>
            <label className="block text-[11px] font-bold mb-0.5 text-slate-700">{t('تخصيص لمستخدم (اختياري):', 'Assign to User (Optional):')}</label>
            <select
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 bg-white font-bold text-slate-800"
            >
              <option value="">{t('أي مستخدم لديه حساب', 'Any user with an account')}</option>
              {activeUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({t(u.role)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold mb-0.5 text-slate-700">{t('نوع الجهاز المستهدف:', 'Target Device Type:')}</label>
            <select
              value={targetDeviceType}
              onChange={(e) => setTargetDeviceType(e.target.value as any)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 bg-white font-bold text-slate-800"
            >
              <option value="any">{t('كل الأنظمة (Android / iOS / Windows)', 'All Platforms (Android / iOS / Windows)')}</option>
              <option value="android">{t('هواتف Android فقط', 'Android Phones Only')}</option>
              <option value="ios">{t('هواتف iPhone / iPad فقط', 'iPhone / iPad Only')}</option>
              <option value="windows">{t('كمبيوتر Windows فقط', 'Windows PC Only')}</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold mb-0.5 text-slate-700">{t('وضع الاتصال بالرابط:', 'Link Connection Mode:')}</label>
            <select
              value={connectionMode}
              onChange={(e) => setConnectionMode(e.target.value as any)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 bg-white font-bold text-slate-800"
            >
              <option value="auto">
                {t('تلقائي', 'Auto')} ({getConnectionModeLabel(autoPairingTarget.effectiveMode)})
              </option>
              <option value="local_network">{t('الشبكة المحلية (Local Network)', 'Local Network (LAN)')}</option>
              <option value="free_remote">{t('النفق المجاني (Quick Tunnel)', 'Free Quick Tunnel')}</option>
              <option value="pro_remote">{t('دومين احترافي (Pro Remote)', 'Pro Remote Domain')}</option>
              <option value="cloud_vps">{t('سيرفر سحابي (Cloud VPS)', 'Cloud VPS Server')}</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold mb-0.5 text-slate-700">{t('صلاحية الرابط:', 'Link Expiration:')}</label>
            <select
              value={ttlMinutes}
              onChange={(e) => setTtlMinutes(Number(e.target.value))}
              className="w-full h-8 border border-slate-300 rounded-md px-2 bg-white font-bold text-slate-800"
            >
              <option value={15}>{t('15 دقيقة', '15 Minutes')}</option>
              <option value={60}>{t('ساعة واحدة', '1 Hour')}</option>
              <option value={1440}>{t('24 ساعة (يوم واحد)', '24 Hours (1 Day)')}</option>
              <option value={10080}>{t('7 أيام', '7 Days')}</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-[11px] font-bold mb-0.5 text-slate-700">{t('ملاحظة إدارية (اختيارية):', 'Admin Note (Optional):')}</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2.5"
            />
          </div>

          <div className="md:col-span-2 flex flex-wrap items-center gap-3 pt-2">
            <label className="flex items-center gap-1.5 cursor-pointer font-bold text-slate-800">
              <input
                type="checkbox"
                checked={singleUse}
                onChange={(e) => setSingleUse(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-[#003589]"
              />
              <span>{t('رابط لمرة واحدة فقط (Single-Use)', 'Single-Use Link Only')}</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer font-bold text-slate-800">
              <input
                type="checkbox"
                checked={requireAdminApproval}
                onChange={(e) => setRequireAdminApproval(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-[#003589]"
              />
              <span>{t('يتطلب موافقة الإدارة بعد الربط', 'Requires Admin Approval After Pairing')}</span>
            </label>
          </div>

          <div
            className={`md:col-span-2 lg:col-span-4 p-2.5 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
              targetUrlValidation.valid
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                : 'bg-red-50 border-red-200 text-red-900'
            }`}
          >
            <div className="space-y-0.5 min-w-0">
              <div className="font-black flex items-center gap-1.5">
                {targetUrlValidation.valid ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                ) : (
                  <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                )}
                <span>
                  {t('معاينة السيرفر قبل إنشاء الدعوة', 'Server Preview Before Creating Invite')} (
                  {connectionMode === 'auto'
                    ? `${t('تلقائي', 'Auto')} → ${getConnectionModeLabel(pairingTarget.effectiveMode)}`
                    : getConnectionModeLabel(pairingTarget.effectiveMode)}
                  ):
                </span>
              </div>
              <div
                dir="ltr"
                className={`font-mono text-[11px] font-bold break-all ${
                  targetUrlValidation.valid ? 'text-emerald-800' : 'text-red-700'
                }`}
              >
                {targetUrlValidation.normalizedUrl || pairingTarget.endpointUrl || t('— غير مُعدّ —', '— Not Configured —')}
              </div>
              {!targetUrlValidation.valid && (
                <p className="text-[11px] font-bold text-red-700">
                  {targetUrlValidation.error}{' '}
                  {t(
                    'يرجى ضبط عنوان هذا الوضع في بطاقات الاتصال أعلاه قبل إنشاء الدعوة.',
                    'Please configure this mode URL in the connection cards above before creating an invite.'
                  )}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={creating || !targetUrlValidation.valid}
              className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0 self-start sm:self-center"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
              <span>{creating ? t('جاري التوليد...', 'Generating...') : t('توليد رابط الربط ورمز QR', 'Generate Pairing Link & QR')}</span>
            </button>
          </div>
        </form>

        {/* Active Generated Invite Display */}
        {createdInvite && (
          <div className="p-2.5 rounded-lg bg-slate-50 border border-[#DCE6F5] grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
            <div className="md:col-span-4 flex justify-center">
              <QrCodeDisplay
                value={createdInvite.qrPayload}
                title={t('امسح الرمز بكاميرا الهاتف أو التطبيق', 'Scan with Phone Camera or App')}
                subtitle={`${t('ينتهي في', 'Expires at')} ${formatLocaleDateTime(createdInvite.tokenRecord.expiresAt)}`}
                filename={`AWLAD_SELIM_QR_${createdInvite.tokenRecord.id}.png`}
              />
            </div>
            <div className="md:col-span-8 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-black text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
                  <Link2 className="w-4 h-4 text-[#003589]" />
                  <span>{t('رابط الدعوة المباشر جاهز للإرسال', 'Direct Invite Link Ready to Share')}</span>
                </h4>
                <span className="px-2 py-0.5 rounded bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] font-bold text-[10px]">
                  {getConnectionModeLabel(createdInvite.tokenRecord.connectionMode)}
                </span>
              </div>

              <div className="px-2.5 py-1.5 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-bold text-[#011E58]">{t('عنوان السيرفر المُضمَّن في الدعوة:', 'Embedded Server URL:')}</span>
                <span dir="ltr" className="font-mono font-bold text-[#003589] break-all">
                  {createdInvite.serverBaseUrl}
                </span>
              </div>

              <div className="p-2 rounded-md bg-white border border-slate-200 space-y-1">
                <span className="text-[11px] font-bold text-slate-500 block">
                  {t('الرابط المباشر (يفتح التطبيق أو صفحة التحميل تلقائياً):', 'Direct Link (Automatically opens app or download page):')}
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    readOnly
                    dir="ltr"
                    value={createdInvite.directInviteUrl}
                    className="flex-1 h-8 font-mono text-xs bg-slate-50 border border-slate-200 rounded-md px-2 text-slate-900 select-all"
                  />
                  <button
                    type="button"
                    onClick={() => copyText(createdInvite.directInviteUrl, t('رابط الربط المباشر', 'Direct Pairing Link'))}
                    className="h-8 px-2.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-bold flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{t('نسخ', 'Copy')}</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => handleShareInvite(createdInvite)}
                  className="px-3 py-1.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>{t('مشاركة / نسخ رسالة الدعوة الكاملة', 'Share / Copy Full Invite Message')}</span>
                </button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(buildWhatsappText(createdInvite))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-md bg-[#25D366]/15 hover:bg-[#25D366]/25 border border-[#25D366]/40 text-emerald-900 font-bold flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{t('إرسال عبر WhatsApp', 'Send via WhatsApp')}</span>
                </a>
                <button
                  type="button"
                  onClick={() => copyText(createdInvite.rawToken, t('رمز الربط اليدوي', 'Manual Pairing Token'))}
                  className="px-2.5 py-1.5 rounded-md bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  {t('نسخ الرمز فقط', 'Copy Token Only')}
                </button>
              </div>

              <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-2 font-bold">
                {t(
                  'ملاحظة أمنية: هذا الرابط يُجهز إعداد السيرفر فقط، ويلزم بعده إدخال اسم المستخدم وكلمة المرور المعتادة داخل التطبيق.',
                  'Security Note: This link only configures the server address. Users still must sign in with their regular username and password inside the app.'
                )}
              </p>
            </div>
          </div>
        )}

        {/* Recent Pairing Tokens Table */}
        {tokens.length > 0 && (
          <div className="pt-2">
            <UnifiedDataTable<PairingTokenRecord>
              compact
              title={t(`سجل روابط الربط المصدرة (${tokens.length})`, `Issued Pairing Links Log (${tokens.length})`)}
              data={tokens}
              rowKey={(tok) => tok.id}
              defaultPageSize={12}
              searchPlaceholder={t('بحث بالرمز أو المستخدم أو الوضع...', 'Search by token, user, or mode...')}
              exportFilename="AWLAD_SELIM_Pairing_Tokens"
              columns={[
                {
                  key: 'tokenPreview',
                  header: t('الرمز', 'Token'),
                  sortValue: (tok) => tok.tokenPreview,
                  exportValue: (tok) => tok.tokenPreview,
                  render: (tok) => (
                    <span className="font-mono text-slate-800" dir="ltr">
                      {tok.tokenPreview}
                    </span>
                  ),
                },
                {
                  key: 'targetUserName',
                  header: t('المستخدم / الجهاز المستهدف', 'Target User / Device'),
                  sortValue: (tok) => tok.targetUserName || t('أي مستخدم مصرح', 'Any Authorized User'),
                  exportValue: (tok) => tok.targetUserName || t('أي مستخدم مصرح', 'Any Authorized User'),
                  render: (tok) => (
                    <div>
                      <div className="font-bold text-slate-900">{tok.targetUserName || t('أي مستخدم مصرح', 'Any Authorized User')}</div>
                      <div className="text-[10px] text-slate-500">
                        {tok.targetDeviceType === 'any' ? t('كل الأجهزة', 'All Devices') : deviceTypeLabel(tok.targetDeviceType, t)}
                        {tok.requireAdminApproval ? ` • ${t('بموافقة الإدارة', 'Admin Approval Required')}` : ''}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'connectionMode',
                  header: t('وضع الاتصال', 'Connection Mode'),
                  sortValue: (tok) => getConnectionModeLabel(tok.connectionMode),
                  exportValue: (tok) => getConnectionModeLabel(tok.connectionMode),
                  render: (tok) => (
                    <span className="text-slate-700 font-bold">{getConnectionModeLabel(tok.connectionMode)}</span>
                  ),
                },
                {
                  key: 'expiresAt',
                  header: t('تاريخ الانتهاء', 'Expires At'),
                  sortValue: (tok) => tok.expiresAt,
                  exportValue: (tok) => formatLocaleDateTime(tok.expiresAt),
                  render: (tok) => (
                    <span className="font-mono tabular-nums text-slate-600" dir="ltr">
                      {formatLocaleDateTime(tok.expiresAt)}
                    </span>
                  ),
                },
                {
                  key: 'usedCount',
                  header: t('الاستخدام', 'Usage'),
                  align: 'center',
                  sortValue: (tok) => tok.usedCount,
                  exportValue: (tok) => `${tok.usedCount}${tok.singleUse ? ' / 1' : ''}`,
                  render: (tok) => (
                    <span className="font-mono tabular-nums font-bold text-slate-800">
                      {tok.usedCount}
                      {tok.singleUse ? ' / 1' : ''}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: t('الحالة', 'Status'),
                  align: 'center',
                  sortValue: (tok) => tok.status,
                  exportValue: (tok) =>
                    tok.status === 'active'
                      ? t('نشط', 'Active')
                      : tok.status === 'used'
                      ? t('مُستخدم', 'Used')
                      : tok.status === 'revoked'
                      ? t('ملغي', 'Revoked')
                      : t('منتهي', 'Expired'),
                  render: (tok) => (
                    <span
                      className={`px-2 py-0.5 rounded font-bold border text-[10px] ${
                        tok.status === 'active'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : tok.status === 'used'
                          ? 'bg-blue-50 text-blue-800 border-blue-200'
                          : tok.status === 'revoked'
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {tok.status === 'active'
                        ? t('نشط', 'Active')
                        : tok.status === 'used'
                        ? t('مُستخدم', 'Used')
                        : tok.status === 'revoked'
                        ? t('ملغي', 'Revoked')
                        : t('منتهي', 'Expired')}
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  header: t('الإجراءات', 'Actions'),
                  align: 'center',
                  sortable: false,
                  render: (tok) =>
                    tok.status === 'active' ? (
                      <button
                        type="button"
                        disabled={busyId === tok.id}
                        onClick={() => handleRevokeToken(tok.id)}
                        className="px-2 py-0.5 rounded-md text-[11px] bg-red-50 hover:bg-red-100 text-red-700 font-bold cursor-pointer disabled:opacity-50"
                      >
                        {t('إلغاء', 'Revoke')}
                      </button>
                    ) : (
                      <span className="text-slate-400">—</span>
                    ),
                },
              ]}
            />
          </div>
        )}
      </div>

      {/* 2. Connected & Paired Device Management */}
      <div className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b pb-1.5">
          <div>
            <h3 className="text-xs sm:text-sm font-black text-slate-900 flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-blue-900" />
              <span>{t('إدارة الأجهزة المرتبطة بالسيرفر (Device Management)', 'Paired Device Management')}</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {t(
                'متابعة أجهزة Windows و Android و iPhone المرتبطة، اعتماد الأجهزة الجديدة، إعادة إرسال روابط الربط، أو فصل الجهاز فوراً.',
                'Monitor paired Windows, Android, and iPhone devices, approve new devices, resend pairing links, or revoke devices immediately.'
              )}
            </p>
          </div>
        </div>

        {/* Summary Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden">
          <div className="px-2 py-1.5 bg-slate-50">
            <span className="text-[10px] text-slate-500 font-bold block">{t('إجمالي الأجهزة', 'Total Devices')}</span>
            <strong className="text-xs font-black font-mono tabular-nums text-slate-900">{summary.total}</strong>
          </div>
          <div className="px-2 py-1.5 bg-emerald-50/70">
            <span className="text-[10px] text-emerald-700 font-bold block">{t('أجهزة نشطة', 'Active Devices')}</span>
            <strong className="text-xs font-black font-mono tabular-nums text-emerald-800">{summary.active}</strong>
          </div>
          <div className="px-2 py-1.5 bg-[#EEF3FA]">
            <span className="text-[10px] text-[#003589] font-bold block">{t('متصل حالياً (5 د)', 'Online Now (5m)')}</span>
            <strong className="text-xs font-black font-mono tabular-nums text-[#011E58]">{summary.onlineNow}</strong>
          </div>
          <div className="px-2 py-1.5 bg-amber-50/70">
            <span className="text-[10px] text-amber-800 font-bold block">{t('بانتظار الاعتماد', 'Pending Approval')}</span>
            <strong className="text-xs font-black font-mono tabular-nums text-amber-900">{summary.pendingApproval}</strong>
          </div>
          <div className="px-2 py-1.5 bg-red-50/70">
            <span className="text-[10px] text-red-700 font-bold block">{t('مفصول / ملغي', 'Revoked')}</span>
            <strong className="text-xs font-black font-mono tabular-nums text-red-800">{summary.revoked}</strong>
          </div>
        </div>

        <UnifiedDataTable<PairedDevice>
          compact
          data={devices}
          rowKey={(dev) => dev.deviceId}
          searchPlaceholder={t('بحث باسم الجهاز أو المستخدم أو العنوان...', 'Search by device name, user, or address...')}
          exportFilename="AWLAD_SELIM_Paired_Devices"
          pdfTitle={t('الأجهزة المرتبطة بالسيرفر', 'Paired Server Devices')}
          emptyTitle={t('لا توجد أجهزة مسجلة في السجل بعد', 'No paired devices registered yet')}
          emptySubtitle={t('ستظهر هنا أي أجهزة يتم ربطها عبر رابط الدعوة أو QR أو عند تسجيل الدخول.', 'Devices paired via invite link, QR code, or login will appear here.')}
          columns={[
            {
              key: 'deviceName',
              header: t('الجهاز والنوع', 'Device & Platform'),
              sortValue: (dev) => dev.deviceName,
              exportValue: (dev) => `${dev.deviceName} (${deviceTypeLabel(dev.deviceType, t)})`,
              render: (dev) => (
                <div className="flex items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-slate-100 border border-slate-200">
                    <DevicePlatformIcon type={dev.deviceType} />
                  </span>
                  <div>
                    <div className="font-black text-slate-900 flex items-center gap-1.5">
                      <span>{dev.deviceName}</span>
                      {dev.isRecentlyOnline && (
                        <span
                          className="inline-block w-2 h-2 rounded bg-emerald-500"
                          title={t('متصل حديثاً', 'Recently Online')}
                        />
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono" dir="ltr">
                      {deviceTypeLabel(dev.deviceType, t)} • {dev.deviceId.slice(0, 14)}
                      {dev.ipAddress ? ` • ${dev.ipAddress}` : ''}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              key: 'linkedUserName',
              header: t('المستخدم المرتبط', 'Linked User'),
              sortValue: (dev) => dev.linkedUserName || '',
              exportValue: (dev) => dev.linkedUserName || t('بانتظار تسجيل الدخول', 'Awaiting Login'),
              render: (dev) => (
                <span className="font-bold text-slate-800">
                  {dev.linkedUserName || t('بانتظار تسجيل الدخول', 'Awaiting Login')}
                </span>
              ),
            },
            {
              key: 'connectionMode',
              header: t('وضع الاتصال المستخدم', 'Connection Mode Used'),
              sortValue: (dev) => getConnectionModeLabel(dev.connectionMode),
              exportValue: (dev) => getConnectionModeLabel(dev.connectionMode),
              render: (dev) => (
                <div>
                  <div className="font-bold text-slate-800">{getConnectionModeLabel(dev.connectionMode)}</div>
                  {dev.serverUrlUsed && (
                    <div className="text-[10px] font-mono text-slate-500 truncate max-w-[180px]" dir="ltr">
                      {dev.serverUrlUsed}
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: 'pairedAt',
              header: t('تاريخ الربط', 'Paired At'),
              sortValue: (dev) => dev.pairedAt,
              exportValue: (dev) => formatLocaleDateTime(dev.pairedAt),
              render: (dev) => (
                <span className="font-mono tabular-nums text-slate-600" dir="ltr">
                  {formatLocaleDateTime(dev.pairedAt)}
                </span>
              ),
            },
            {
              key: 'lastSeenAt',
              header: t('آخر اتصال', 'Last Seen'),
              sortValue: (dev) => dev.lastSeenAt,
              exportValue: (dev) => formatLocaleDateTime(dev.lastSeenAt),
              render: (dev) => (
                <span className="font-mono tabular-nums text-slate-700" dir="ltr">
                  {formatLocaleDateTime(dev.lastSeenAt)}
                </span>
              ),
            },
            {
              key: 'status',
              header: t('الحالة', 'Status'),
              align: 'center',
              sortValue: (dev) => dev.status,
              exportValue: (dev) =>
                dev.status === 'active'
                  ? t('نشط ومعتمد', 'Active & Approved')
                  : dev.status === 'pending_approval'
                  ? t('بانتظار الاعتماد', 'Pending Approval')
                  : t('ملغي / مفصول', 'Revoked / Disconnected'),
              render: (dev) => (
                <span
                  className={`px-2 py-0.5 rounded font-bold border text-[10px] inline-flex items-center gap-1 ${
                    dev.status === 'active'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : dev.status === 'pending_approval'
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-red-50 text-red-700 border-red-200'
                  }`}
                >
                  {dev.status === 'active' && <CheckCircle2 className="w-3 h-3" />}
                  {dev.status === 'pending_approval' && <ShieldAlert className="w-3 h-3" />}
                  {dev.status === 'revoked' && <XCircle className="w-3 h-3" />}
                  <span>
                    {dev.status === 'active'
                      ? t('نشط ومعتمد', 'Active & Approved')
                      : dev.status === 'pending_approval'
                      ? t('بانتظار الاعتماد', 'Pending Approval')
                      : t('ملغي / مفصول', 'Revoked / Disconnected')}
                  </span>
                </span>
              ),
            },
            {
              key: 'actions',
              header: t('إجراءات الإدارة', 'Actions'),
              align: 'center',
              sortable: false,
              render: (dev) => (
                <div className="flex flex-wrap items-center justify-center gap-1">
                  {dev.status === 'pending_approval' && (
                    <button
                      type="button"
                      disabled={busyId === dev.deviceId}
                      onClick={() => handleApproveDevice(dev.deviceId)}
                      className="px-2 py-0.5 rounded-md text-[11px] bg-[#003589] hover:bg-[#0049B0] text-white font-bold cursor-pointer disabled:opacity-50"
                    >
                      {t('اعتماد', 'Approve')}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === dev.deviceId}
                    onClick={() => handleResendDeviceLink(dev)}
                    className="px-2 py-0.5 rounded-md text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold cursor-pointer disabled:opacity-50"
                    title={t('توليد رابط و QR جديد لهذا الجهاز', 'Generate new link & QR for this device')}
                  >
                    {t('إعادة إرسال رابط', 'Resend Link')}
                  </button>
                  {dev.status !== 'revoked' && (
                    <button
                      type="button"
                      disabled={busyId === dev.deviceId}
                      onClick={() => setDeviceToRevoke(dev)}
                      className="px-2 py-0.5 rounded-md text-[11px] bg-red-50 hover:bg-red-100 text-red-700 font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>{t('فصل', 'Revoke')}</span>
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>

      <ConfirmDialog
        isOpen={Boolean(deviceToRevoke)}
        title={t('تأكيد فصل وإلغاء ربط الجهاز', 'Confirm Device Disconnect & Revocation')}
        message={
          deviceToRevoke
            ? t(
                `هل أنت متأكد من فصل الجهاز (${deviceToRevoke.deviceName})؟ سيتم إنهاء جميع جلساته النشطة ومنعه من الوصول للسيرفر حتى إعادة ربطه من جديد.`,
                `Are you sure you want to disconnect device (${deviceToRevoke.deviceName})? All its active sessions will be terminated and server access blocked until re-paired.`
              )
            : ''
        }
        confirmLabel={t('نعم، فصل الجهاز فوراً', 'Yes, Revoke Device Now')}
        cancelLabel={t('تراجع', 'Cancel')}
        variant="danger"
        onConfirm={handleConfirmRevokeDevice}
        onClose={() => setDeviceToRevoke(null)}
      />
    </div>
  );
};

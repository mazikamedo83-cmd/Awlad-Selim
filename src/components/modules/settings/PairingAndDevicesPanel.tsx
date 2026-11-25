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

function deviceTypeLabel(type: string): string {
  switch (type) {
    case 'windows':
      return 'Windows';
    case 'android':
      return 'Android';
    case 'ios':
      return 'iPhone / iOS';
    default:
      return 'Web Browser';
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
      setError(err?.message || 'تعذر تحميل قائمة الأجهزة وروابط الربط');
    } finally {
      setLoading(false);
    }
  }, []);

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
          'عنوان السيرفر المختار غير صالح لإنشاء رابط الربط. يرجى ضبط عنوان الوضع المختار أولاً.'
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
      onShowToast('تم إنشاء رابط الربط المباشر ورمز QR بنجاح');
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'تعذر إنشاء رابط الربط');
    } finally {
      setCreating(false);
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    setBusyId(tokenId);
    try {
      await apiRequest(`/api/admin/pairing/tokens/${tokenId}/revoke`, { method: 'POST' });
      onShowToast('تم إلغاء رابط الربط');
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'تعذر إلغاء الرابط');
    } finally {
      setBusyId(null);
    }
  };

  const handleApproveDevice = async (deviceId: string) => {
    setBusyId(deviceId);
    try {
      await apiRequest(`/api/admin/devices/${deviceId}/approve`, { method: 'POST' });
      onShowToast('تم اعتماد الجهاز وتفعيل صلاحية دخوله');
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'تعذر اعتماد الجهاز');
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
      onShowToast('تم فصل الجهاز وإلغاء جميع جلساته النشطة فوراً');
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'تعذر فصل الجهاز');
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
          `عنوان السيرفر لوضع (${getConnectionModeLabel(resendTarget.effectiveMode)}) غير صالح لإعادة إرسال الرابط.`
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
      onShowToast(`تم توليد رابط ربط جديد للجهاز (${device.deviceName})`);
      await loadAll();
    } catch (err: any) {
      setError(err?.message || 'تعذر إعادة إنشاء رابط الربط');
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
    onShowToast(`تم نسخ ${label}`);
  };

  const buildWhatsappText = (invite: PairingCreateResponse): string => {
    const modeTitle = getConnectionModeLabel(invite.tokenRecord.connectionMode);
    const target = invite.tokenRecord.targetUserName
      ? `\nالحساب المخصص: ${invite.tokenRecord.targetUserName}`
      : '';
    return [
      'دعوة ربط جهاز بنظام AWLAD SELIM (أولاد سليم):',
      `اضغط على الرابط التالي لإعداد السيرفر تلقائياً على جهازك (${modeTitle}):`,
      invite.directInviteUrl,
      target,
      'ملاحظة: بعد فتح التطبيق سيُطلب منك تسجيل الدخول باسم المستخدم وكلمة المرور المعتادة.',
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
          title: 'رابط ربط جهاز — AWLAD SELIM',
        });
        return;
      }
      try {
        await (navigator as any).share({
          title: 'دعوة ربط جهاز — AWLAD SELIM',
          text,
          url: invite.directInviteUrl,
        });
        return;
      } catch {
        // fallback to clipboard
      }
    }
    copyText(text, 'رسالة الدعوة المباشرة');
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
              <span>الربط الذكي للأجهزة (رابط دعوة مباشر + QR Code)</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              يُعدّ عنوان السيرفر تلقائياً على Android و iPhone و Windows ويفتح شاشة تسجيل الدخول المعتادة — لا تُضمَّن أي كلمات مرور أو أسرار في الرابط.
            </p>
          </div>
          <button
            type="button"
            onClick={loadAll}
            disabled={loading}
            className="h-7 px-2 rounded-md text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center gap-1 cursor-pointer self-start"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث السجلات</span>
          </button>
        </div>

        <form onSubmit={handleCreatePairing} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
          <div>
            <label className="block text-[11px] font-bold mb-0.5 text-slate-700">تخصيص لمستخدم (اختياري):</label>
            <select
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 bg-white font-bold text-slate-800"
            >
              <option value="">أي مستخدم لديه حساب</option>
              {activeUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({u.role})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold mb-0.5 text-slate-700">نوع الجهاز المستهدف:</label>
            <select
              value={targetDeviceType}
              onChange={(e) => setTargetDeviceType(e.target.value as any)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 bg-white font-bold text-slate-800"
            >
              <option value="any">كل الأنظمة (Android / iOS / Windows)</option>
              <option value="android">هواتف Android فقط</option>
              <option value="ios">هواتف iPhone / iPad فقط</option>
              <option value="windows">كمبيوتر Windows فقط</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold mb-0.5 text-slate-700">وضع الاتصال بالرابط:</label>
            <select
              value={connectionMode}
              onChange={(e) => setConnectionMode(e.target.value as any)}
              className="w-full h-8 border border-slate-300 rounded-md px-2 bg-white font-bold text-slate-800"
            >
              <option value="auto">
                تلقائي (Auto — {getConnectionModeLabel(autoPairingTarget.effectiveMode)})
              </option>
              <option value="local_network">الشبكة المحلية (Local Network)</option>
              <option value="free_remote">النفق المجاني (Quick Tunnel)</option>
              <option value="pro_remote">دومين احترافي (Pro Remote)</option>
              <option value="cloud_vps">سيرفر سحابي (Cloud VPS)</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold mb-0.5 text-slate-700">صلاحية الرابط:</label>
            <select
              value={ttlMinutes}
              onChange={(e) => setTtlMinutes(Number(e.target.value))}
              className="w-full h-8 border border-slate-300 rounded-md px-2 bg-white font-bold text-slate-800"
            >
              <option value={15}>15 دقيقة</option>
              <option value={60}>ساعة واحدة</option>
              <option value={1440}>24 ساعة (يوم واحد)</option>
              <option value={10080}>7 أيام</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-[11px] font-bold mb-0.5 text-slate-700">ملاحظة إدارية (اختيارية):</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: هاتف مندوب خط القاهرة / موبايل عميل جديد"
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
              <span>رابط لمرة واحدة فقط (Single-Use)</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer font-bold text-slate-800">
              <input
                type="checkbox"
                checked={requireAdminApproval}
                onChange={(e) => setRequireAdminApproval(e.target.checked)}
                className="w-3.5 h-3.5 rounded text-[#003589]"
              />
              <span>يتطلب موافقة الإدارة بعد الربط</span>
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
                  معاينة السيرفر قبل إنشاء الدعوة ({connectionMode === 'auto' ? `تلقائي ← ${getConnectionModeLabel(pairingTarget.effectiveMode)}` : getConnectionModeLabel(pairingTarget.effectiveMode)}):
                </span>
              </div>
              <div
                dir="ltr"
                className={`font-mono text-[11px] font-bold break-all ${
                  targetUrlValidation.valid ? 'text-emerald-800' : 'text-red-700'
                }`}
              >
                {targetUrlValidation.normalizedUrl || pairingTarget.endpointUrl || '— غير مُعدّ —'}
              </div>
              {!targetUrlValidation.valid && (
                <p className="text-[11px] font-bold text-red-700">
                  {targetUrlValidation.error} يرجى ضبط عنوان هذا الوضع في بطاقات الاتصال أعلاه قبل إنشاء الدعوة.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={creating || !targetUrlValidation.valid}
              className="h-8 px-3 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0 self-start sm:self-center"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCode className="w-3.5 h-3.5" />}
              <span>{creating ? 'جاري التوليد...' : 'توليد رابط الربط ورمز QR'}</span>
            </button>
          </div>
        </form>

        {/* Active Generated Invite Display */}
        {createdInvite && (
          <div className="p-2.5 rounded-lg bg-slate-50 border border-[#DCE6F5] grid grid-cols-1 md:grid-cols-12 gap-2.5 items-center">
            <div className="md:col-span-4 flex justify-center">
              <QrCodeDisplay
                value={createdInvite.qrPayload}
                title="امسح الرمز بكاميرا الهاتف أو التطبيق"
                subtitle={`ينتهي في ${new Date(createdInvite.tokenRecord.expiresAt).toLocaleString('ar-EG')}`}
                filename={`AWLAD_SELIM_QR_${createdInvite.tokenRecord.id}.png`}
              />
            </div>
            <div className="md:col-span-8 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-black text-xs sm:text-sm text-slate-900 flex items-center gap-1.5">
                  <Link2 className="w-4 h-4 text-[#003589]" />
                  <span>رابط الدعوة المباشر جاهز للإرسال</span>
                </h4>
                <span className="px-2 py-0.5 rounded bg-[#EEF3FA] text-[#011E58] border border-[#DCE6F5] font-bold text-[10px]">
                  {getConnectionModeLabel(createdInvite.tokenRecord.connectionMode)}
                </span>
              </div>

              <div className="px-2.5 py-1.5 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-bold text-[#011E58]">عنوان السيرفر المُضمَّن في الدعوة:</span>
                <span dir="ltr" className="font-mono font-bold text-[#003589] break-all">
                  {createdInvite.serverBaseUrl}
                </span>
              </div>

              <div className="p-2 rounded-md bg-white border border-slate-200 space-y-1">
                <span className="text-[11px] font-bold text-slate-500 block">الرابط المباشر (يفتح التطبيق أو صفحة التحميل تلقائياً):</span>
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
                    onClick={() => copyText(createdInvite.directInviteUrl, 'رابط الربط المباشر')}
                    className="h-8 px-2.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-bold flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>نسخ</span>
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
                  <span>مشاركة / نسخ رسالة الدعوة الكاملة</span>
                </button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(buildWhatsappText(createdInvite))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-md bg-[#25D366]/15 hover:bg-[#25D366]/25 border border-[#25D366]/40 text-emerald-900 font-bold flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>إرسال عبر WhatsApp</span>
                </a>
                <button
                  type="button"
                  onClick={() => copyText(createdInvite.rawToken, 'رمز الربط اليدوي')}
                  className="px-2.5 py-1.5 rounded-md bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  نسخ الرمز فقط
                </button>
              </div>

              <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-md p-2 font-bold">
                ملاحظة أمنية: هذا الرابط يُجهز إعداد السيرفر فقط، ويلزم بعده إدخال اسم المستخدم وكلمة المرور المعتادة داخل التطبيق.
              </p>
            </div>
          </div>
        )}

        {/* Recent Pairing Tokens Table */}
        {tokens.length > 0 && (
          <div className="pt-2">
            <UnifiedDataTable<PairingTokenRecord>
              compact
              title={`سجل روابط الربط المصدرة (${tokens.length})`}
              data={tokens}
              rowKey={(t) => t.id}
              defaultPageSize={12}
              searchPlaceholder="بحث بالرمز أو المستخدم أو الوضع..."
              exportFilename="AWLAD_SELIM_Pairing_Tokens"
              columns={[
                {
                  key: 'tokenPreview',
                  header: 'الرمز',
                  sortValue: (t) => t.tokenPreview,
                  exportValue: (t) => t.tokenPreview,
                  render: (t) => (
                    <span className="font-mono text-slate-800" dir="ltr">
                      {t.tokenPreview}
                    </span>
                  ),
                },
                {
                  key: 'targetUserName',
                  header: 'المستخدم / الجهاز المستهدف',
                  sortValue: (t) => t.targetUserName || 'أي مستخدم مصرح',
                  exportValue: (t) => t.targetUserName || 'أي مستخدم مصرح',
                  render: (t) => (
                    <div>
                      <div className="font-bold text-slate-900">{t.targetUserName || 'أي مستخدم مصرح'}</div>
                      <div className="text-[10px] text-slate-500">
                        {t.targetDeviceType === 'any' ? 'كل الأجهزة' : deviceTypeLabel(t.targetDeviceType)}
                        {t.requireAdminApproval ? ' • بموافقة الإدارة' : ''}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'connectionMode',
                  header: 'وضع الاتصال',
                  sortValue: (t) => getConnectionModeLabel(t.connectionMode),
                  exportValue: (t) => getConnectionModeLabel(t.connectionMode),
                  render: (t) => (
                    <span className="text-slate-700 font-bold">{getConnectionModeLabel(t.connectionMode)}</span>
                  ),
                },
                {
                  key: 'expiresAt',
                  header: 'تاريخ الانتهاء',
                  sortValue: (t) => t.expiresAt,
                  exportValue: (t) => new Date(t.expiresAt).toLocaleString('en-GB'),
                  render: (t) => (
                    <span className="font-mono tabular-nums text-slate-600" dir="ltr">
                      {new Date(t.expiresAt).toLocaleString('en-GB')}
                    </span>
                  ),
                },
                {
                  key: 'usedCount',
                  header: 'الاستخدام',
                  align: 'center',
                  sortValue: (t) => t.usedCount,
                  exportValue: (t) => `${t.usedCount}${t.singleUse ? ' / 1' : ''}`,
                  render: (t) => (
                    <span className="font-mono tabular-nums font-bold text-slate-800">
                      {t.usedCount}
                      {t.singleUse ? ' / 1' : ''}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: 'الحالة',
                  align: 'center',
                  sortValue: (t) => t.status,
                  exportValue: (t) =>
                    t.status === 'active'
                      ? 'نشط'
                      : t.status === 'used'
                      ? 'مُستخدم'
                      : t.status === 'revoked'
                      ? 'ملغي'
                      : 'منتهي',
                  render: (t) => (
                    <span
                      className={`px-2 py-0.5 rounded font-bold border text-[10px] ${
                        t.status === 'active'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : t.status === 'used'
                          ? 'bg-blue-50 text-blue-800 border-blue-200'
                          : t.status === 'revoked'
                          ? 'bg-red-50 text-red-700 border-red-200'
                          : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}
                    >
                      {t.status === 'active'
                        ? 'نشط'
                        : t.status === 'used'
                        ? 'مُستخدم'
                        : t.status === 'revoked'
                        ? 'ملغي'
                        : 'منتهي'}
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  header: 'الإجراءات',
                  align: 'center',
                  sortable: false,
                  render: (t) =>
                    t.status === 'active' ? (
                      <button
                        type="button"
                        disabled={busyId === t.id}
                        onClick={() => handleRevokeToken(t.id)}
                        className="px-2 py-0.5 rounded-md text-[11px] bg-red-50 hover:bg-red-100 text-red-700 font-bold cursor-pointer disabled:opacity-50"
                      >
                        إلغاء
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
              <span>إدارة الأجهزة المرتبطة بالسيرفر (Device Management)</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              متابعة أجهزة Windows و Android و iPhone المرتبطة، اعتماد الأجهزة الجديدة، إعادة إرسال روابط الربط، أو فصل الجهاز فوراً.
            </p>
          </div>
        </div>

        {/* Summary Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-slate-200 border border-slate-200 rounded-md overflow-hidden">
          <div className="px-2 py-1.5 bg-slate-50">
            <span className="text-[10px] text-slate-500 font-bold block">إجمالي الأجهزة</span>
            <strong className="text-xs font-black font-mono tabular-nums text-slate-900">{summary.total}</strong>
          </div>
          <div className="px-2 py-1.5 bg-emerald-50/70">
            <span className="text-[10px] text-emerald-700 font-bold block">أجهزة نشطة</span>
            <strong className="text-xs font-black font-mono tabular-nums text-emerald-800">{summary.active}</strong>
          </div>
          <div className="px-2 py-1.5 bg-[#EEF3FA]">
            <span className="text-[10px] text-[#003589] font-bold block">متصل حالياً (5 د)</span>
            <strong className="text-xs font-black font-mono tabular-nums text-[#011E58]">{summary.onlineNow}</strong>
          </div>
          <div className="px-2 py-1.5 bg-amber-50/70">
            <span className="text-[10px] text-amber-800 font-bold block">بانتظار الاعتماد</span>
            <strong className="text-xs font-black font-mono tabular-nums text-amber-900">{summary.pendingApproval}</strong>
          </div>
          <div className="px-2 py-1.5 bg-red-50/70">
            <span className="text-[10px] text-red-700 font-bold block">مفصول / ملغي</span>
            <strong className="text-xs font-black font-mono tabular-nums text-red-800">{summary.revoked}</strong>
          </div>
        </div>

        <UnifiedDataTable<PairedDevice>
          compact
          data={devices}
          rowKey={(dev) => dev.deviceId}
          searchPlaceholder="بحث باسم الجهاز أو المستخدم أو العنوان..."
          exportFilename="AWLAD_SELIM_Paired_Devices"
          pdfTitle="الأجهزة المرتبطة بالسيرفر"
          emptyTitle="لا توجد أجهزة مسجلة في السجل بعد"
          emptySubtitle="ستظهر هنا أي أجهزة يتم ربطها عبر رابط الدعوة أو QR أو عند تسجيل الدخول."
          columns={[
            {
              key: 'deviceName',
              header: 'الجهاز والنوع',
              sortValue: (dev) => dev.deviceName,
              exportValue: (dev) => `${dev.deviceName} (${deviceTypeLabel(dev.deviceType)})`,
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
                          title="متصل حديثاً"
                        />
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono" dir="ltr">
                      {deviceTypeLabel(dev.deviceType)} • {dev.deviceId.slice(0, 14)}
                      {dev.ipAddress ? ` • ${dev.ipAddress}` : ''}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              key: 'linkedUserName',
              header: 'المستخدم المرتبط',
              sortValue: (dev) => dev.linkedUserName || '',
              exportValue: (dev) => dev.linkedUserName || 'بانتظار تسجيل الدخول',
              render: (dev) => (
                <span className="font-bold text-slate-800">
                  {dev.linkedUserName || 'بانتظار تسجيل الدخول'}
                </span>
              ),
            },
            {
              key: 'connectionMode',
              header: 'وضع الاتصال المستخدم',
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
              header: 'تاريخ الربط',
              sortValue: (dev) => dev.pairedAt,
              exportValue: (dev) => new Date(dev.pairedAt).toLocaleString('en-GB'),
              render: (dev) => (
                <span className="font-mono tabular-nums text-slate-600" dir="ltr">
                  {new Date(dev.pairedAt).toLocaleString('en-GB')}
                </span>
              ),
            },
            {
              key: 'lastSeenAt',
              header: 'آخر اتصال',
              sortValue: (dev) => dev.lastSeenAt,
              exportValue: (dev) => new Date(dev.lastSeenAt).toLocaleString('en-GB'),
              render: (dev) => (
                <span className="font-mono tabular-nums text-slate-700" dir="ltr">
                  {new Date(dev.lastSeenAt).toLocaleString('en-GB')}
                </span>
              ),
            },
            {
              key: 'status',
              header: 'الحالة',
              align: 'center',
              sortValue: (dev) => dev.status,
              exportValue: (dev) =>
                dev.status === 'active'
                  ? 'نشط ومعتمد'
                  : dev.status === 'pending_approval'
                  ? 'بانتظار الاعتماد'
                  : 'ملغي / مفصول',
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
                      ? 'نشط ومعتمد'
                      : dev.status === 'pending_approval'
                      ? 'بانتظار الاعتماد'
                      : 'ملغي / مفصول'}
                  </span>
                </span>
              ),
            },
            {
              key: 'actions',
              header: 'إجراءات الإدارة',
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
                      اعتماد
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === dev.deviceId}
                    onClick={() => handleResendDeviceLink(dev)}
                    className="px-2 py-0.5 rounded-md text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold cursor-pointer disabled:opacity-50"
                    title="توليد رابط و QR جديد لهذا الجهاز"
                  >
                    إعادة إرسال رابط
                  </button>
                  {dev.status !== 'revoked' && (
                    <button
                      type="button"
                      disabled={busyId === dev.deviceId}
                      onClick={() => setDeviceToRevoke(dev)}
                      className="px-2 py-0.5 rounded-md text-[11px] bg-red-50 hover:bg-red-100 text-red-700 font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>فصل</span>
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
        title="تأكيد فصل وإلغاء ربط الجهاز"
        message={
          deviceToRevoke
            ? `هل أنت متأكد من فصل الجهاز (${deviceToRevoke.deviceName})؟ سيتم إنهاء جميع جلساته النشطة ومنعه من الوصول للسيرفر حتى إعادة ربطه من جديد.`
            : ''
        }
        confirmLabel="نعم، فصل الجهاز فوراً"
        cancelLabel="تراجع"
        variant="danger"
        onConfirm={handleConfirmRevokeDevice}
        onClose={() => setDeviceToRevoke(null)}
      />
    </div>
  );
};

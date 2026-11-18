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
import { apiRequest, getConnectionModeLabel } from '../../../services/api';
import { isNativeCapacitor, saveAndShareDocument } from '../../../services/native';
import { QrCodeDisplay } from '../../common/QrCodeDisplay';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import type {
  ConnectionMode,
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
  if (type === 'android' || type === 'ios') return <Smartphone className="w-4 h-4 text-emerald-700" />;
  return <Globe className="w-4 h-4 text-slate-600" />;
}

export const PairingAndDevicesPanel: React.FC<PairingAndDevicesPanelProps> = ({
  users,
  activeMode,
  activeEndpoint,
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

  const handleCreatePairing = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const res = await apiRequest<PairingCreateResponse>('/api/admin/pairing/tokens', {
        method: 'POST',
        body: {
          targetUserId: targetUserId || undefined,
          targetDeviceType,
          connectionMode,
          ttlMinutes,
          singleUse,
          requireAdminApproval,
          notes,
          serverBaseUrl: activeEndpoint || undefined,
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
    setBusyId(device.deviceId);
    try {
      const res = await apiRequest<PairingCreateResponse>(
        `/api/admin/devices/${device.deviceId}/resend-link`,
        {
          method: 'POST',
          body: { serverBaseUrl: activeEndpoint || undefined },
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
    <div className="space-y-6 text-xs">
      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 1. Direct Invite Link & QR Code Pairing Generator */}
      <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
          <div>
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <QrCode className="w-4 h-4 text-emerald-700" />
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
            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center gap-1.5 cursor-pointer self-start"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>تحديث السجلات</span>
          </button>
        </div>

        <form onSubmit={handleCreatePairing} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block font-bold mb-1 text-slate-700">تخصيص لمستخدم (اختياري):</label>
            <select
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              className="w-full border border-slate-300 rounded-xl p-2.5 bg-white font-bold text-slate-800"
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
            <label className="block font-bold mb-1 text-slate-700">نوع الجهاز المستهدف:</label>
            <select
              value={targetDeviceType}
              onChange={(e) => setTargetDeviceType(e.target.value as any)}
              className="w-full border border-slate-300 rounded-xl p-2.5 bg-white font-bold text-slate-800"
            >
              <option value="any">كل الأنظمة (Android / iOS / Windows)</option>
              <option value="android">هواتف Android فقط</option>
              <option value="ios">هواتف iPhone / iPad فقط</option>
              <option value="windows">كمبيوتر Windows فقط</option>
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1 text-slate-700">وضع الاتصال بالرابط:</label>
            <select
              value={connectionMode}
              onChange={(e) => setConnectionMode(e.target.value as any)}
              className="w-full border border-slate-300 rounded-xl p-2.5 bg-white font-bold text-slate-800"
            >
              <option value="auto">الوضع النشط ({getConnectionModeLabel(activeMode)})</option>
              <option value="local_network">الشبكة المحلية (Local Network)</option>
              <option value="free_remote">النفق المجاني (Quick Tunnel)</option>
              <option value="pro_remote">دومين احترافي (Pro Remote)</option>
              <option value="cloud_vps">سيرفر سحابي (Cloud VPS)</option>
            </select>
          </div>

          <div>
            <label className="block font-bold mb-1 text-slate-700">صلاحية الرابط:</label>
            <select
              value={ttlMinutes}
              onChange={(e) => setTtlMinutes(Number(e.target.value))}
              className="w-full border border-slate-300 rounded-xl p-2.5 bg-white font-bold text-slate-800"
            >
              <option value={15}>15 دقيقة</option>
              <option value={60}>ساعة واحدة</option>
              <option value={1440}>24 ساعة (يوم واحد)</option>
              <option value={10080}>7 أيام</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block font-bold mb-1 text-slate-700">ملاحظة إدارية (اختيارية):</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثال: هاتف مندوب خط القاهرة / موبايل عميل جديد"
              className="w-full border border-slate-300 rounded-xl p-2.5"
            />
          </div>

          <div className="md:col-span-2 flex flex-wrap items-center gap-4 pt-3">
            <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800">
              <input
                type="checkbox"
                checked={singleUse}
                onChange={(e) => setSingleUse(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-700"
              />
              <span>رابط لمرة واحدة فقط (Single-Use)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-800">
              <input
                type="checkbox"
                checked={requireAdminApproval}
                onChange={(e) => setRequireAdminApproval(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-700"
              />
              <span>يتطلب موافقة الإدارة بعد الربط</span>
            </label>
            <button
              type="submit"
              disabled={creating}
              className="mr-auto px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-black flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
              <span>{creating ? 'جاري التوليد...' : 'توليد رابط الربط ورمز QR'}</span>
            </button>
          </div>
        </form>

        {/* Active Generated Invite Display */}
        {createdInvite && (
          <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border-2 border-emerald-300 grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
            <div className="md:col-span-4 flex justify-center">
              <QrCodeDisplay
                value={createdInvite.qrPayload}
                title="امسح الرمز بكاميرا الهاتف أو التطبيق"
                subtitle={`ينتهي في ${new Date(createdInvite.tokenRecord.expiresAt).toLocaleString('ar-EG')}`}
                filename={`AWLAD_SELIM_QR_${createdInvite.tokenRecord.id}.png`}
              />
            </div>
            <div className="md:col-span-8 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-black text-sm text-slate-900 flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-emerald-700" />
                  <span>رابط الدعوة المباشر جاهز للإرسال</span>
                </h4>
                <span className="px-2.5 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold text-[11px]">
                  {getConnectionModeLabel(createdInvite.tokenRecord.connectionMode)}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-white border border-slate-200 space-y-1.5">
                <span className="text-[11px] font-bold text-slate-500 block">الرابط المباشر (يفتح التطبيق أو صفحة التحميل تلقائياً):</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    dir="ltr"
                    value={createdInvite.directInviteUrl}
                    className="flex-1 font-mono text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-slate-900 select-all"
                  />
                  <button
                    type="button"
                    onClick={() => copyText(createdInvite.directInviteUrl, 'رابط الربط المباشر')}
                    className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>نسخ</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleShareInvite(createdInvite)}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>مشاركة / نسخ رسالة الدعوة الكاملة</span>
                </button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(buildWhatsappText(createdInvite))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 rounded-xl bg-[#25D366]/15 hover:bg-[#25D366]/25 border border-[#25D366]/40 text-emerald-900 font-bold flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>إرسال عبر WhatsApp</span>
                </a>
                <button
                  type="button"
                  onClick={() => copyText(createdInvite.rawToken, 'رمز الربط اليدوي')}
                  className="px-3 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold cursor-pointer"
                >
                  نسخ الرمز فقط
                </button>
              </div>

              <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-2.5 font-bold">
                ملاحظة أمنية: هذا الرابط يُجهز إعداد السيرفر فقط، ويلزم بعده إدخال اسم المستخدم وكلمة المرور المعتادة داخل التطبيق.
              </p>
            </div>
          </div>
        )}

        {/* Recent Pairing Tokens Table */}
        {tokens.length > 0 && (
          <div className="space-y-2 pt-2">
            <h4 className="font-black text-slate-800 text-xs flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>سجل روابط الربط المصدرة ({tokens.length})</span>
            </h4>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-right border-collapse">
                <thead className="bg-slate-50 text-[11px] text-slate-600 font-black border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">الرمز</th>
                    <th className="py-2.5 px-3">المستخدم / الجهاز المستهدف</th>
                    <th className="py-2.5 px-3">وضع الاتصال</th>
                    <th className="py-2.5 px-3">تاريخ الانتهاء</th>
                    <th className="py-2.5 px-3">الاستخدام</th>
                    <th className="py-2.5 px-3">الحالة</th>
                    <th className="py-2.5 px-3">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-[11px]">
                  {tokens.slice(0, 12).map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 font-mono text-slate-800" dir="ltr">
                        {t.tokenPreview}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900">{t.targetUserName || 'أي مستخدم مصرح'}</div>
                        <div className="text-[10px] text-slate-500">
                          {t.targetDeviceType === 'any' ? 'كل الأجهزة' : deviceTypeLabel(t.targetDeviceType)}
                          {t.requireAdminApproval ? ' • بموافقة الإدارة' : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 font-bold">
                        {getConnectionModeLabel(t.connectionMode)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600" dir="ltr">
                        {new Date(t.expiresAt).toLocaleString('en-GB')}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-800">
                        {t.usedCount}{t.singleUse ? ' / 1' : ''}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-lg font-bold border text-[10px] ${
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
                      </td>
                      <td className="py-2.5 px-3">
                        {t.status === 'active' ? (
                          <button
                            type="button"
                            disabled={busyId === t.id}
                            onClick={() => handleRevokeToken(t.id)}
                            className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-bold cursor-pointer disabled:opacity-50"
                          >
                            إلغاء
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 2. Connected & Paired Device Management */}
      <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
          <div>
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-blue-900" />
              <span>إدارة الأجهزة المرتبطة بالسيرفر (Device Management)</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              متابعة أجهزة Windows و Android و iPhone المرتبطة، اعتماد الأجهزة الجديدة، إعادة إرسال روابط الربط، أو فصل الجهاز فوراً.
            </p>
          </div>
        </div>

        {/* Summary Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-[10px] text-slate-500 font-bold block">إجمالي الأجهزة</span>
            <strong className="text-base font-black font-mono text-slate-900">{summary.total}</strong>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <span className="text-[10px] text-emerald-700 font-bold block">أجهزة نشطة</span>
            <strong className="text-base font-black font-mono text-emerald-800">{summary.active}</strong>
          </div>
          <div className="p-3 rounded-xl bg-sky-50 border border-sky-200">
            <span className="text-[10px] text-sky-700 font-bold block">متصل حالياً (5 د)</span>
            <strong className="text-base font-black font-mono text-sky-800">{summary.onlineNow}</strong>
          </div>
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
            <span className="text-[10px] text-amber-800 font-bold block">بانتظار الاعتماد</span>
            <strong className="text-base font-black font-mono text-amber-900">{summary.pendingApproval}</strong>
          </div>
          <div className="p-3 rounded-xl bg-red-50 border border-red-200">
            <span className="text-[10px] text-red-700 font-bold block">مفصول / ملغي</span>
            <strong className="text-base font-black font-mono text-red-800">{summary.revoked}</strong>
          </div>
        </div>

        {devices.length === 0 ? (
          <div className="p-8 rounded-2xl bg-slate-50 border border-dashed border-slate-300 text-center text-slate-500 space-y-1">
            <p className="font-bold text-slate-700">لا توجد أجهزة مسجلة في السجل بعد</p>
            <p className="text-[11px]">ستظهر هنا أي أجهزة يتم ربطها عبر رابط الدعوة أو QR أو عند تسجيل الدخول.</p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-right border-collapse">
              <thead className="bg-slate-50 text-[11px] text-slate-600 font-black border-b border-slate-200">
                <tr>
                  <th className="py-3 px-3">الجهاز والنوع</th>
                  <th className="py-3 px-3">المستخدم المرتبط</th>
                  <th className="py-3 px-3">وضع الاتصال المستخدم</th>
                  <th className="py-3 px-3">تاريخ الربط</th>
                  <th className="py-3 px-3">آخر اتصال</th>
                  <th className="py-3 px-3">الحالة</th>
                  <th className="py-3 px-3">إجراءات الإدارة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[11px]">
                {devices.map((dev) => (
                  <tr key={dev.deviceId} className="hover:bg-slate-50/70">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 rounded-lg bg-slate-100 border border-slate-200">
                          <DevicePlatformIcon type={dev.deviceType} />
                        </span>
                        <div>
                          <div className="font-black text-slate-900 flex items-center gap-1.5">
                            <span>{dev.deviceName}</span>
                            {dev.isRecentlyOnline && (
                              <span
                                className="inline-block w-2 h-2 rounded-full bg-emerald-500"
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
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-bold text-slate-800">
                        {dev.linkedUserName || 'بانتظار تسجيل الدخول'}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-800">{getConnectionModeLabel(dev.connectionMode)}</div>
                      {dev.serverUrlUsed && (
                        <div className="text-[10px] font-mono text-slate-500 truncate max-w-[180px]" dir="ltr">
                          {dev.serverUrlUsed}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-600" dir="ltr">
                      {new Date(dev.pairedAt).toLocaleString('en-GB')}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-700" dir="ltr">
                      {new Date(dev.lastSeenAt).toLocaleString('en-GB')}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-lg font-bold border text-[10px] inline-flex items-center gap-1 ${
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
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {dev.status === 'pending_approval' && (
                          <button
                            type="button"
                            disabled={busyId === dev.deviceId}
                            onClick={() => handleApproveDevice(dev.deviceId)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer disabled:opacity-50"
                          >
                            اعتماد
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busyId === dev.deviceId}
                          onClick={() => handleResendDeviceLink(dev)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold cursor-pointer disabled:opacity-50"
                          title="توليد رابط و QR جديد لهذا الجهاز"
                        >
                          إعادة إرسال رابط
                        </button>
                        {dev.status !== 'revoked' && (
                          <button
                            type="button"
                            disabled={busyId === dev.deviceId}
                            onClick={() => setDeviceToRevoke(dev)}
                            className="px-2.5 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>فصل</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

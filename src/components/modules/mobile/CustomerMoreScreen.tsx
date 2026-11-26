import React, { useState } from 'react';
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Globe,
  Heart,
  HelpCircle,
  Info,
  Lock,
  LogOut,
  MapPin,
  Moon,
  Phone,
  Receipt,
  RefreshCw,
  Server,
  ShieldCheck,
  Sun,
  Monitor,
  User as UserIcon,
  Wallet,
  X,
  CheckCircle2,
  Edit3,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useData } from '../../../context/DataContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleNumber } from '../../../i18n/translator';
import { CustomerLocationPickerModal, PickedCustomerLocation } from '../../common/CustomerLocationPickerModal';
import { CustomerLocationViewerModal } from '../../common/CustomerLocationViewerModal';

interface CustomerMoreScreenProps {
  allowPriceView: boolean;
  ordersCount: number;
  invoicesCount: number;
  favoritesCount: number;
  onOpenSection: (section: 'orders' | 'invoices' | 'statement' | 'favorites') => void;
  onOpenNotifications: () => void;
  onOpenServerModal: () => void;
  onOpenSyncCenter: () => void;
  onLogout: () => void;
}

export const CustomerMoreScreen: React.FC<CustomerMoreScreenProps> = ({
  allowPriceView,
  ordersCount,
  invoicesCount,
  favoritesCount,
  onOpenSection,
  onOpenNotifications,
  onOpenServerModal,
  onOpenSyncCenter,
  onLogout,
}) => {
  const { currentUser, customerProfile, updatePassword } = useAuth();
  const data = useData();
  const { themePreference, setThemePreference, language, setLanguage, isRtl, t } = usePreferences();
  const NavChevron = isRtl ? ChevronLeft : ChevronRight;

  const customer = data.customers[0] || customerProfile || null;

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editShopName, setEditShopName] = useState(customer?.shopName || '');
  const [editPhone, setEditPhone] = useState(customer?.phone || currentUser?.phone || '');
  const [editAddress, setEditAddress] = useState(customer?.address || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [isLocationPickerOpen, setIsLocationPickerOpen] = useState(false);
  const [isLocationViewerOpen, setIsLocationViewerOpen] = useState(false);

  const [showPwdBox, setShowPwdBox] = useState(false);
  const [currPwd, setCurrPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [savingPwd, setSavingPwd] = useState(false);

  const [infoModal, setInfoModal] = useState<'privacy' | 'help' | 'about' | null>(null);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    const res = await data.updateOwnCustomerProfile({
      shopName: editShopName.trim(),
      phone: editPhone.trim(),
      address: editAddress.trim(),
    });
    setSavingProfile(false);
    if (res.success) {
      setIsEditingProfile(false);
      setProfileMsg({ type: 'success', text: t('تم تحديث بيانات الحساب والمحل بنجاح.', 'Account & shop details updated successfully.') });
    } else {
      setProfileMsg({ type: 'error', text: res.error ? t(res.error) : t('تعذر حفظ التعديلات.', 'Failed to save changes.') });
    }
  };

  const handleConfirmLocation = async (loc: PickedCustomerLocation) => {
    setSavingProfile(true);
    setProfileMsg(null);
    const res = await data.updateOwnCustomerProfile({
      latitude: loc.latitude,
      longitude: loc.longitude,
      geoCoordinates: loc.geoCoordinates,
      address: loc.address || customer?.address,
      area: loc.area || customer?.area,
      city: loc.city || customer?.city,
      governorate: loc.governorate || customer?.governorate,
      locationCapturedAt: loc.locationCapturedAt,
    });
    setSavingProfile(false);
    if (res.success) {
      setEditAddress(loc.address || editAddress);
      setProfileMsg({ type: 'success', text: t('تم حفظ موقع المحل على الخريطة بنجاح.', 'Shop map location saved successfully.') });
    } else {
      setProfileMsg({ type: 'error', text: res.error ? t(res.error) : t('تعذر حفظ الموقع.', 'Failed to save location.') });
    }
  };

  const hasSavedLocation = Boolean(
    (customer?.latitude && customer?.longitude) || customer?.geoCoordinates
  );

  return (
    <div className="space-y-2 pb-2">
      {profileMsg && (
        <div
          className={`p-2 rounded-lg border text-xs font-bold flex items-center gap-2 ${
            profileMsg.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{profileMsg.text}</span>
        </div>
      )}

      {/* Profile & Saved Location Card */}
      <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-2.5 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-md bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white flex items-center justify-center shrink-0">
              <UserIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-[#F3F7FC] truncate">
                {customer?.shopName || customer?.name || currentUser?.fullName}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-[#97AECE] truncate">
                {customer?.code ? `${customer.code} · ` : ''}@{currentUser?.username}
                {customer?.phone ? ` · ${customer.phone}` : ''}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setEditShopName(customer?.shopName || '');
              setEditPhone(customer?.phone || currentUser?.phone || '');
              setEditAddress(customer?.address || '');
              setIsEditingProfile((v) => !v);
            }}
            className="h-8 px-2 rounded-md bg-slate-100 dark:bg-[#132544] border border-transparent dark:border-[#21375C] text-slate-700 dark:text-[#DCE6F5] text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>{t('تعديل', 'Edit')}</span>
          </button>
        </div>

        {allowPriceView && (
          <div className="px-2.5 py-1.5 rounded-md bg-slate-50 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] flex items-center justify-between text-xs">
            <span className="font-bold text-slate-600 dark:text-[#A9BCD9]">{t('الرصيد الحالي:', 'Current Balance:')}</span>
            <strong
              className={`text-xs sm:text-sm font-black awlad-tabular ${
                (customer?.currentBalance || 0) > 0
                  ? 'text-red-700 dark:text-red-400'
                  : (customer?.currentBalance || 0) < 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-900 dark:text-[#F3F7FC]'
              }`}
            >
              {formatLocaleNumber(Math.abs(customer?.currentBalance || 0))} {t(data.settings.currency)}
              {' '}
              {(customer?.currentBalance || 0) > 0 ? t('(مدين)', '(Debit)') : (customer?.currentBalance || 0) < 0 ? t('(دائن)', '(Credit)') : ''}
            </strong>
          </div>
        )}

        {/* Map Location Actions */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={savingProfile}
            onClick={() => setIsLocationPickerOpen(true)}
            className="h-8 px-2 rounded-md bg-[#EEF3FA] dark:bg-[#132544] border border-[#DCE6F5] dark:border-[#2A436E] text-[var(--awlad-royal-700)] dark:text-[#85B8FF] text-[11px] font-black flex items-center justify-center gap-1 cursor-pointer"
          >
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span>{hasSavedLocation ? t('تحديث الموقع', 'Update Location') : t('تحديد الموقع', 'Pick Location')}</span>
          </button>
          <button
            type="button"
            disabled={!hasSavedLocation}
            onClick={() => setIsLocationViewerOpen(true)}
            className="h-8 px-2 rounded-md bg-slate-100 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C] text-slate-700 dark:text-[#DCE6F5] disabled:opacity-50 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer"
          >
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span>{t('عرض الموقع', 'View Location')}</span>
          </button>
        </div>

        {isEditingProfile && (
          <form onSubmit={handleSaveProfile} className="pt-2 border-t border-slate-100 dark:border-[#1B2F52] space-y-1.5 text-xs">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('اسم المحل / النشاط:', 'Shop / Business Name:')}</label>
              <input
                type="text"
                value={editShopName}
                onChange={(e) => setEditShopName(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] px-2"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('رقم الهاتف:', 'Phone Number:')}</label>
              <input
                type="tel"
                dir="ltr"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] px-2 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('العنوان التفصيلي:', 'Detailed Address:')}</label>
              <input
                type="text"
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] px-2"
              />
            </div>
            <button
              type="submit"
              disabled={savingProfile}
              className="w-full h-8 rounded-md bg-[var(--awlad-royal-700)] hover:bg-[var(--awlad-royal-600)] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white font-black cursor-pointer"
            >
              {savingProfile ? t('جاري الحفظ...', 'Saving...') : t('حفظ البيانات', 'Save Changes')}
            </button>
          </form>
        )}
      </div>

      {/* Orders, Invoices, Statement, Favorites */}
      <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] divide-y divide-slate-100 dark:divide-[#1B2F52] overflow-hidden text-xs">
        <button
          type="button"
          onClick={() => onOpenSection('orders')}
          className="w-full min-h-[36px] px-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#1A3461] cursor-pointer"
        >
          <span className="flex items-center gap-2 font-black text-slate-800 dark:text-[#F3F7FC]">
            <ClipboardList className="w-4 h-4 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
            <span>{t('طلباتي وتتبع الشحنات', 'My Orders & Tracking')}</span>
          </span>
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-[#97AECE] font-bold awlad-tabular">
            <span>{formatLocaleNumber(ordersCount)}</span>
            <NavChevron className="w-3.5 h-3.5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onOpenSection('invoices')}
          className="w-full min-h-[36px] px-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#1A3461] cursor-pointer"
        >
          <span className="flex items-center gap-2 font-black text-slate-800 dark:text-[#F3F7FC]">
            <Receipt className="w-4 h-4 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
            <span>{t('فواتيري المعتمدة', 'My Invoices')}</span>
          </span>
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-[#97AECE] font-bold awlad-tabular">
            <span>{formatLocaleNumber(invoicesCount)}</span>
            <NavChevron className="w-3.5 h-3.5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onOpenSection('statement')}
          className="w-full min-h-[36px] px-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#1A3461] cursor-pointer"
        >
          <span className="flex items-center gap-2 font-black text-slate-800 dark:text-[#F3F7FC]">
            <Wallet className="w-4 h-4 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
            <span>{t('كشف الحساب التفصيلي', 'Account Statement')}</span>
          </span>
          <NavChevron className="w-3.5 h-3.5 text-slate-400 dark:text-[#849BBF]" />
        </button>

        <button
          type="button"
          onClick={() => onOpenSection('favorites')}
          className="w-full min-h-[36px] px-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#1A3461] cursor-pointer"
        >
          <span className="flex items-center gap-2 font-black text-slate-800 dark:text-[#F3F7FC]">
            <Heart className="w-4 h-4 text-[#C81E1E]" />
            <span>{t('المنتجات المفضلة', 'Favorites')}</span>
          </span>
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-[#97AECE] font-bold awlad-tabular">
            <span>{formatLocaleNumber(favoritesCount)}</span>
            <NavChevron className="w-3.5 h-3.5" />
          </span>
        </button>
      </div>

      {/* Theme & Language Preferences */}
      <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] p-2 space-y-1.5 text-xs">
        <div className="space-y-1">
          <p className="font-black text-[11px] text-slate-700 dark:text-[#DCE6F5]">{t('مظهر التطبيق', 'App Theme')}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                { key: 'light', label: t('نهاري', 'Light'), icon: Sun },
                { key: 'dark', label: t('داكن', 'Dark'), icon: Moon },
                { key: 'system', label: t('النظام', 'System'), icon: Monitor },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const active = themePreference === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setThemePreference(opt.key)}
                  className={`h-8 rounded-md border font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                    active
                      ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white border-[var(--awlad-royal-700)] dark:border-[#60A5FA]/40'
                      : 'bg-slate-50 dark:bg-[#132544] text-slate-700 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C] hover:bg-slate-100 dark:hover:bg-[#1A3461]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1 pt-1.5 border-t border-slate-100 dark:border-[#1B2F52]">
          <p className="font-black text-[11px] text-slate-700 dark:text-[#DCE6F5] flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
            <span>{t('لغة الواجهة', 'Interface Language')}</span>
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setLanguage('ar')}
              className={`h-8 rounded-md border font-bold cursor-pointer ${
                language === 'ar'
                  ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white border-[var(--awlad-royal-700)] dark:border-[#60A5FA]/40'
                  : 'bg-slate-50 dark:bg-[#132544] text-slate-700 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C]'
              }`}
            >
              العربية
            </button>
            <button
              type="button"
              onClick={() => setLanguage('en')}
              className={`h-8 rounded-md border font-bold cursor-pointer ${
                language === 'en'
                  ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white border-[var(--awlad-royal-700)] dark:border-[#60A5FA]/40'
                  : 'bg-slate-50 dark:bg-[#132544] text-slate-700 dark:text-[#DCE6F5] border-slate-200 dark:border-[#21375C]'
              }`}
            >
              English
            </button>
          </div>
        </div>
      </div>

      {/* Settings, Sync, Support & Security */}
      <div className="bg-white dark:bg-[#0E1C36] rounded-lg border border-slate-200 dark:border-[#21375C] divide-y divide-slate-100 dark:divide-[#1B2F52] overflow-hidden text-xs">
        <button
          type="button"
          onClick={onOpenNotifications}
          className="w-full min-h-[36px] px-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#1A3461] cursor-pointer"
        >
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-[#F3F7FC]">
            <Bell className="w-4 h-4 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
            <span>{t('التنبيهات والإشعارات', 'Notifications')}</span>
          </span>
          <span className="text-slate-500 dark:text-[#97AECE] font-bold awlad-tabular">{formatLocaleNumber(data.unreadNotificationCount)}</span>
        </button>

        <button
          type="button"
          onClick={onOpenServerModal}
          className="w-full min-h-[36px] px-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#1A3461] cursor-pointer"
        >
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-[#F3F7FC]">
            <Server className="w-4 h-4 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
            <span>{t('السيرفر وإعدادات الاتصال', 'Server & Connection')}</span>
          </span>
          <NavChevron className="w-3.5 h-3.5 text-slate-400 dark:text-[#849BBF]" />
        </button>

        <button
          type="button"
          onClick={onOpenSyncCenter}
          className="w-full min-h-[36px] px-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#1A3461] cursor-pointer"
        >
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-[#F3F7FC]">
            <RefreshCw className="w-4 h-4 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
            <span>{t('مركز المزامنة والعمليات المعلقة', 'Sync Center')}</span>
          </span>
          <span className="text-slate-500 dark:text-[#97AECE] font-bold awlad-tabular">{formatLocaleNumber(data.pendingSyncCount + data.conflictsCount)}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setShowPwdBox((v) => !v);
            setPwdMsg(null);
          }}
          className="w-full min-h-[36px] px-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#1A3461] cursor-pointer"
        >
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-[#F3F7FC]">
            <Lock className="w-4 h-4 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
            <span>{t('تغيير كلمة المرور', 'Change Password')}</span>
          </span>
          <NavChevron className={`w-3.5 h-3.5 text-slate-400 dark:text-[#849BBF] transition-transform ${showPwdBox ? (isRtl ? '-rotate-90' : 'rotate-90') : ''}`} />
        </button>

        {showPwdBox && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setPwdMsg(null);
              if (newPwd.length < 4) {
                setPwdMsg({ type: 'error', text: t('كلمة المرور يجب أن تكون 4 أحرف على الأقل.', 'Password must be at least 4 characters.') });
                return;
              }
              if (newPwd !== confirmPwd) {
                setPwdMsg({ type: 'error', text: t('تأكيد كلمة المرور غير مطابق.', 'Password confirmation does not match.') });
                return;
              }
              setSavingPwd(true);
              const res = await updatePassword(newPwd, currPwd || undefined);
              setSavingPwd(false);
              if (res.success) {
                setCurrPwd('');
                setNewPwd('');
                setConfirmPwd('');
                setPwdMsg({ type: 'success', text: t('تم تحديث كلمة المرور بنجاح.', 'Password updated successfully.') });
              } else {
                setPwdMsg({ type: 'error', text: res.error ? t(res.error) : t('تعذر تحديث كلمة المرور.', 'Failed to update password.') });
              }
            }}
            className="p-2.5 bg-slate-50 dark:bg-[#132544] space-y-1.5"
          >
            {pwdMsg && (
              <p className={`font-bold ${pwdMsg.type === 'success' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>
                {pwdMsg.text}
              </p>
            )}
            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('كلمة المرور الحالية:', 'Current Password:')}</label>
              <input
                type="password"
                dir="ltr"
                required
                value={currPwd}
                onChange={(e) => setCurrPwd(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] px-2.5 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('كلمة المرور الجديدة:', 'New Password:')}</label>
              <input
                type="password"
                dir="ltr"
                required
                minLength={4}
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] px-2.5 font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 dark:text-[#A9BCD9] mb-0.5">{t('تأكيد كلمة المرور الجديدة:', 'Confirm New Password:')}</label>
              <input
                type="password"
                dir="ltr"
                required
                minLength={4}
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] px-2.5 font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={savingPwd}
              className="w-full h-8 rounded-md bg-[var(--awlad-royal-700)] hover:bg-[var(--awlad-royal-600)] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white font-black cursor-pointer"
            >
              {savingPwd ? t('جاري التحديث...', 'Updating...') : t('حفظ كلمة المرور', 'Save Password')}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => setInfoModal('privacy')}
          className="w-full min-h-[36px] px-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#1A3461] cursor-pointer"
        >
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-[#F3F7FC]">
            <ShieldCheck className="w-4 h-4 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
            <span>{t('الخصوصية والأمان', 'Privacy Policy')}</span>
          </span>
          <NavChevron className="w-3.5 h-3.5 text-slate-400 dark:text-[#849BBF]" />
        </button>

        <button
          type="button"
          onClick={() => setInfoModal('help')}
          className="w-full min-h-[36px] px-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#1A3461] cursor-pointer"
        >
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-[#F3F7FC]">
            <HelpCircle className="w-4 h-4 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
            <span>{t('المساعدة والتواصل مع الشركة', 'Help & Contact')}</span>
          </span>
          <NavChevron className="w-3.5 h-3.5 text-slate-400 dark:text-[#849BBF]" />
        </button>

        <button
          type="button"
          onClick={() => setInfoModal('about')}
          className="w-full min-h-[36px] px-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-[#1A3461] cursor-pointer"
        >
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-[#F3F7FC]">
            <Info className="w-4 h-4 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" />
            <span>{t('عن تطبيق أولاد سليم', 'About App')}</span>
          </span>
          <span className="text-[11px] font-mono text-slate-400 dark:text-[#97AECE]">v3.0.0</span>
        </button>
      </div>

      <button
        type="button"
        onClick={onLogout}
        className="w-full h-8 rounded-lg bg-red-50 dark:bg-red-950/40 hover:bg-red-100 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 font-black text-xs flex items-center justify-center gap-2 cursor-pointer"
      >
        <LogOut className="w-4 h-4" />
        <span>{t('تسجيل الخروج', 'Logout')}</span>
      </button>

      <CustomerLocationPickerModal
        isOpen={isLocationPickerOpen}
        onClose={() => setIsLocationPickerOpen(false)}
        onConfirm={handleConfirmLocation}
        initialLat={customer?.latitude}
        initialLng={customer?.longitude}
        initialGeoCoordinates={customer?.geoCoordinates}
        initialAddress={customer?.address}
        initialCity={customer?.city}
        initialArea={customer?.area}
        initialGovernorate={customer?.governorate}
      />

      <CustomerLocationViewerModal
        isOpen={isLocationViewerOpen}
        onClose={() => setIsLocationViewerOpen(false)}
        customerName={customer?.name || currentUser?.fullName || ''}
        shopName={customer?.shopName}
        address={customer?.address}
        city={customer?.city}
        area={customer?.area}
        governorate={customer?.governorate}
        geoCoordinates={customer?.geoCoordinates}
        latitude={customer?.latitude}
        longitude={customer?.longitude}
      />

      {infoModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3">
          <div className="bg-white dark:bg-[#0E1C36] w-full max-w-md rounded-lg border border-slate-200 dark:border-[#21375C] p-3 space-y-2 text-xs shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#1B2F52] pb-1.5">
              <h3 className="text-xs font-black text-slate-900 dark:text-[#F3F7FC]">
                {infoModal === 'privacy'
                  ? t('سياسة الخصوصية وأمان الحساب', 'Privacy Policy & Account Security')
                  : infoModal === 'help'
                  ? t('التواصل والدعم الفني', 'Contact & Support')
                  : t('عن نظام أولاد سليم', 'About Awlad Selim')}
              </h3>
              <button
                type="button"
                onClick={() => setInfoModal(null)}
                aria-label={t('إغلاق', 'Close')}
                className="p-1 rounded-md bg-slate-100 dark:bg-[#132544] text-slate-600 dark:text-[#DCE6F5] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {infoModal === 'privacy' && (
              <p className="text-slate-600 dark:text-[#A9BCD9] leading-relaxed">
                {t(
                  'يتم حفظ بيانات حسابك وفواتيرك وموقع المحل بشكل مشفر ومرتبط مباشرة بسيرفر مؤسسة أولاد سليم. يتم استخدام إحداثيات الموقع فقط لتحديد عنوان التوصيل بدقة وتوجيه المندوبين، ولا تتم مشاركتها مع أي طرف خارجي.',
                  'Your account details, invoices, and shop location are encrypted and synced directly with the Awlad Selim server. Location coordinates are used solely to ensure accurate delivery and guide representatives, and are never shared with third parties.'
                )}
              </p>
            )}
            {infoModal === 'help' && (
              <div className="space-y-2 text-slate-700 dark:text-[#DCE6F5]">
                <p className="font-bold">{data.settings.companyName}</p>
                {data.settings.address && <p>{t('العنوان:', 'Address:')} {data.settings.address}</p>}
                {data.settings.phone1 && (
                  <p className="flex items-center gap-1.5 font-mono" dir="ltr">
                    <Phone className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" /> {data.settings.phone1}
                  </p>
                )}
                {data.settings.phone2 && (
                  <p className="flex items-center gap-1.5 font-mono" dir="ltr">
                    <Phone className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]" /> {data.settings.phone2}
                  </p>
                )}
              </div>
            )}
            {infoModal === 'about' && (
              <div className="space-y-1.5 text-slate-600 dark:text-[#A9BCD9]">
                <p className="font-black text-slate-900 dark:text-[#F3F7FC]">{data.settings.companyName}</p>
                <p>{data.settings.companySubtitle}</p>
                <p className="font-mono text-[11px]">{t('الإصدار:', 'Version:')} v3.0.0</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

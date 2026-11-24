import React, { useState } from 'react';
import {
  Bell,
  ChevronLeft,
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
  const { themePreference, setThemePreference, language, setLanguage, t } = usePreferences();

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
      setProfileMsg({ type: 'success', text: 'تم تحديث بيانات الحساب والمحل بنجاح.' });
    } else {
      setProfileMsg({ type: 'error', text: res.error || 'تعذر حفظ التعديلات.' });
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
      setProfileMsg({ type: 'success', text: 'تم حفظ موقع المحل على الخريطة بنجاح.' });
    } else {
      setProfileMsg({ type: 'error', text: res.error || 'تعذر حفظ الموقع.' });
    }
  };

  const hasSavedLocation = Boolean(
    (customer?.latitude && customer?.longitude) || customer?.geoCoordinates
  );

  return (
    <div className="space-y-2.5 pb-3">
      {profileMsg && (
        <div
          className={`p-2.5 rounded-lg border text-xs font-bold flex items-center gap-2 ${
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
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 shadow-2xs space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#0F5A33] text-white flex items-center justify-center shrink-0">
              <UserIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100 truncate">
                {customer?.shopName || customer?.name || currentUser?.fullName}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
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
            className="min-h-[32px] px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>{t('تعديل', 'Edit')}</span>
          </button>
        </div>

        {allowPriceView && (
          <div className="px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
            <span className="font-bold text-slate-600 dark:text-slate-300">{t('الرصيد الحالي:', 'Current Balance:')}</span>
            <strong
              className={`text-xs sm:text-sm font-black awlad-tabular ${
                (customer?.currentBalance || 0) > 0
                  ? 'text-red-700 dark:text-red-400'
                  : (customer?.currentBalance || 0) < 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {Math.abs(customer?.currentBalance || 0).toLocaleString()} {data.settings.currency}
              {' '}
              {(customer?.currentBalance || 0) > 0 ? '(مدين)' : (customer?.currentBalance || 0) < 0 ? '(دائن)' : ''}
            </strong>
          </div>
        )}

        {/* Map Location Actions */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={savingProfile}
            onClick={() => setIsLocationPickerOpen(true)}
            className="min-h-[36px] px-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[#0F5A33] dark:text-emerald-300 text-[11px] font-black flex items-center justify-center gap-1 cursor-pointer"
          >
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span>{hasSavedLocation ? t('تحديث الموقع', 'Update Location') : t('تحديد الموقع', 'Pick Location')}</span>
          </button>
          <button
            type="button"
            disabled={!hasSavedLocation}
            onClick={() => setIsLocationViewerOpen(true)}
            className="min-h-[36px] px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-50 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer"
          >
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span>{t('عرض الموقع', 'View Location')}</span>
          </button>
        </div>

        {isEditingProfile && (
          <form onSubmit={handleSaveProfile} className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5 text-xs">
            <input
              type="text"
              value={editShopName}
              onChange={(e) => setEditShopName(e.target.value)}
              placeholder="اسم المحل / النشاط"
              className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5"
            />
            <input
              type="tel"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              placeholder="رقم الهاتف"
              className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 font-mono"
            />
            <input
              type="text"
              value={editAddress}
              onChange={(e) => setEditAddress(e.target.value)}
              placeholder="العنوان التفصيلي"
              className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5"
            />
            <button
              type="submit"
              disabled={savingProfile}
              className="w-full min-h-[36px] rounded-lg bg-[#0F5A33] text-white font-black cursor-pointer"
            >
              {savingProfile ? 'جاري الحفظ...' : 'حفظ البيانات'}
            </button>
          </form>
        )}
      </div>

      {/* Orders, Invoices, Statement, Favorites */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden shadow-2xs text-xs">
        <button
          type="button"
          onClick={() => onOpenSection('orders')}
          className="w-full min-h-[42px] px-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
        >
          <span className="flex items-center gap-2 font-black text-slate-800 dark:text-slate-100">
            <ClipboardList className="w-4 h-4 text-[#0F5A33] dark:text-emerald-400" />
            <span>{t('طلباتي وتتبع الشحنات', 'My Orders & Tracking')}</span>
          </span>
          <span className="flex items-center gap-1.5 text-slate-500 font-bold awlad-tabular">
            <span>{ordersCount}</span>
            <ChevronLeft className="w-3.5 h-3.5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onOpenSection('invoices')}
          className="w-full min-h-[42px] px-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
        >
          <span className="flex items-center gap-2 font-black text-slate-800 dark:text-slate-100">
            <Receipt className="w-4 h-4 text-[#0F5A33] dark:text-emerald-400" />
            <span>{t('فواتيري المعتمدة', 'My Invoices')}</span>
          </span>
          <span className="flex items-center gap-1.5 text-slate-500 font-bold awlad-tabular">
            <span>{invoicesCount}</span>
            <ChevronLeft className="w-3.5 h-3.5" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onOpenSection('statement')}
          className="w-full min-h-[42px] px-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
        >
          <span className="flex items-center gap-2 font-black text-slate-800 dark:text-slate-100">
            <Wallet className="w-4 h-4 text-[#0F5A33] dark:text-emerald-400" />
            <span>{t('كشف الحساب التفصيلي', 'Account Statement')}</span>
          </span>
          <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
        </button>

        <button
          type="button"
          onClick={() => onOpenSection('favorites')}
          className="w-full min-h-[42px] px-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
        >
          <span className="flex items-center gap-2 font-black text-slate-800 dark:text-slate-100">
            <Heart className="w-4 h-4 text-[#C81E1E]" />
            <span>{t('المنتجات المفضلة', 'Favorites')}</span>
          </span>
          <span className="flex items-center gap-1.5 text-slate-500 font-bold awlad-tabular">
            <span>{favoritesCount}</span>
            <ChevronLeft className="w-3.5 h-3.5" />
          </span>
        </button>
      </div>

      {/* Theme & Language Preferences */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 space-y-2 shadow-2xs text-xs">
        <div className="space-y-1">
          <p className="font-black text-[11px] text-slate-700 dark:text-slate-200">{t('مظهر التطبيق', 'App Theme')}</p>
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
                  className={`min-h-[34px] rounded-lg border font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                    active
                      ? 'bg-[#0F5A33] text-white border-[#0F5A33]'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1 pt-1.5 border-t border-slate-100 dark:border-slate-800">
          <p className="font-black text-[11px] text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-[#0F5A33] dark:text-emerald-400" />
            <span>{t('لغة الواجهة', 'Interface Language')}</span>
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setLanguage('ar')}
              className={`min-h-[34px] rounded-lg border font-bold cursor-pointer ${
                language === 'ar'
                  ? 'bg-[#0F5A33] text-white border-[#0F5A33]'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
              }`}
            >
              العربية (RTL)
            </button>
            <button
              type="button"
              onClick={() => setLanguage('en')}
              className={`min-h-[34px] rounded-lg border font-bold cursor-pointer ${
                language === 'en'
                  ? 'bg-[#0F5A33] text-white border-[#0F5A33]'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
              }`}
            >
              English (LTR)
            </button>
          </div>
        </div>
      </div>

      {/* Settings, Sync, Support & Security */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden shadow-2xs text-xs">
        <button
          type="button"
          onClick={onOpenNotifications}
          className="w-full min-h-[40px] px-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
        >
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
            <Bell className="w-4 h-4 text-[#0F5A33] dark:text-emerald-400" />
            <span>{t('التنبيهات والإشعارات', 'Notifications')}</span>
          </span>
          <span className="text-slate-500 font-bold awlad-tabular">{data.unreadNotificationCount}</span>
        </button>

        <button
          type="button"
          onClick={onOpenServerModal}
          className="w-full min-h-[40px] px-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
        >
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
            <Server className="w-4 h-4 text-[#0F5A33] dark:text-emerald-400" />
            <span>{t('السيرفر وإعدادات الاتصال', 'Server & Connection')}</span>
          </span>
          <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
        </button>

        <button
          type="button"
          onClick={onOpenSyncCenter}
          className="w-full min-h-[40px] px-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
        >
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
            <RefreshCw className="w-4 h-4 text-[#0F5A33] dark:text-emerald-400" />
            <span>{t('مركز المزامنة والعمليات المعلقة', 'Sync Center')}</span>
          </span>
          <span className="text-slate-500 font-bold awlad-tabular">{data.pendingSyncCount + data.conflictsCount}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setShowPwdBox((v) => !v);
            setPwdMsg(null);
          }}
          className="w-full min-h-[40px] px-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
        >
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
            <Lock className="w-4 h-4 text-[#0F5A33] dark:text-emerald-400" />
            <span>{t('تغيير كلمة المرور', 'Change Password')}</span>
          </span>
          <ChevronLeft className={`w-3.5 h-3.5 text-slate-400 transition-transform ${showPwdBox ? '-rotate-90' : ''}`} />
        </button>

        {showPwdBox && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setPwdMsg(null);
              if (newPwd.length < 4) {
                setPwdMsg({ type: 'error', text: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل.' });
                return;
              }
              if (newPwd !== confirmPwd) {
                setPwdMsg({ type: 'error', text: 'تأكيد كلمة المرور غير مطابق.' });
                return;
              }
              setSavingPwd(true);
              const res = await updatePassword(newPwd, currPwd || undefined);
              setSavingPwd(false);
              if (res.success) {
                setCurrPwd('');
                setNewPwd('');
                setConfirmPwd('');
                setPwdMsg({ type: 'success', text: 'تم تحديث كلمة المرور بنجاح.' });
              } else {
                setPwdMsg({ type: 'error', text: res.error || 'تعذر تحديث كلمة المرور.' });
              }
            }}
            className="p-4 bg-slate-50 dark:bg-slate-800/60 space-y-2"
          >
            {pwdMsg && (
              <p className={`font-bold ${pwdMsg.type === 'success' ? 'text-emerald-700' : 'text-red-600'}`}>
                {pwdMsg.text}
              </p>
            )}
            <input
              type="password"
              required
              value={currPwd}
              onChange={(e) => setCurrPwd(e.target.value)}
              placeholder="كلمة المرور الحالية"
              className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 font-mono"
            />
            <input
              type="password"
              required
              minLength={4}
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
              placeholder="كلمة المرور الجديدة"
              className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 font-mono"
            />
            <input
              type="password"
              required
              minLength={4}
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              placeholder="تأكيد كلمة المرور الجديدة"
              className="w-full min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 font-mono"
            />
            <button
              type="submit"
              disabled={savingPwd}
              className="w-full min-h-[40px] rounded-xl bg-[#0F5A33] text-white font-black cursor-pointer"
            >
              {savingPwd ? 'جاري التحديث...' : 'حفظ كلمة المرور'}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => setInfoModal('privacy')}
          className="w-full min-h-[40px] px-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
        >
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
            <ShieldCheck className="w-4 h-4 text-[#0F5A33] dark:text-emerald-400" />
            <span>{t('الخصوصية والأمان', 'Privacy Policy')}</span>
          </span>
          <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
        </button>

        <button
          type="button"
          onClick={() => setInfoModal('help')}
          className="w-full min-h-[40px] px-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
        >
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
            <HelpCircle className="w-4 h-4 text-[#0F5A33] dark:text-emerald-400" />
            <span>{t('المساعدة والتواصل مع الشركة', 'Help & Contact')}</span>
          </span>
          <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
        </button>

        <button
          type="button"
          onClick={() => setInfoModal('about')}
          className="w-full min-h-[40px] px-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
        >
          <span className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
            <Info className="w-4 h-4 text-[#0F5A33] dark:text-emerald-400" />
            <span>{t('عن تطبيق أولاد سليم', 'About App')}</span>
          </span>
          <span className="text-[11px] font-mono text-slate-400">v3.0.0</span>
        </button>
      </div>

      <button
        type="button"
        onClick={onLogout}
        className="w-full min-h-[40px] rounded-xl bg-red-50 dark:bg-red-950/40 hover:bg-red-100 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 font-black text-xs flex items-center justify-center gap-2 cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5 text-xs shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">
                {infoModal === 'privacy'
                  ? 'سياسة الخصوصية وأمان الحساب'
                  : infoModal === 'help'
                  ? 'التواصل والدعم الفني'
                  : 'عن نظام أولاد سليم'}
              </h3>
              <button
                type="button"
                onClick={() => setInfoModal(null)}
                className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {infoModal === 'privacy' && (
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                يتم حفظ بيانات حسابك وفواتيرك وموقع المحل بشكل مشفر ومرتبط مباشرة بسيرفر مؤسسة أولاد سليم. يتم استخدام إحداثيات الموقع فقط لتحديد عنوان التوصيل بدقة وتوجيه المندوبين، ولا تتم مشاركتها مع أي طرف خارجي.
              </p>
            )}
            {infoModal === 'help' && (
              <div className="space-y-2 text-slate-700 dark:text-slate-300">
                <p className="font-bold">{data.settings.companyName}</p>
                {data.settings.address && <p>العنوان: {data.settings.address}</p>}
                {data.settings.phone1 && (
                  <p className="flex items-center gap-1.5 font-mono">
                    <Phone className="w-3.5 h-3.5 text-[#0F5A33]" /> {data.settings.phone1}
                  </p>
                )}
                {data.settings.phone2 && (
                  <p className="flex items-center gap-1.5 font-mono">
                    <Phone className="w-3.5 h-3.5 text-[#0F5A33]" /> {data.settings.phone2}
                  </p>
                )}
              </div>
            )}
            {infoModal === 'about' && (
              <div className="space-y-1.5 text-slate-600 dark:text-slate-300">
                <p className="font-black text-slate-900 dark:text-slate-100">{data.settings.companyName}</p>
                <p>{data.settings.companySubtitle}</p>
                <p className="font-mono text-[11px]">الإصدار: v3.0.0</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

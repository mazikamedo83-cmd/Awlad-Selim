import React, { useState } from 'react';
import {
  Users,
  ArrowLeftRight,
  Trash2,
  Plus,
  CheckCircle2,
  AlertCircle,
  Lock,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { SavedDeviceAccount } from '../../../services/accountVault';
import { Modal } from '../../common/Modal';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { SavedAccountsIcon } from '../../common/AppIcons';

function getRoleBadge(role: string, t: (ar: string, en?: string) => string): string {
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

export const AccountSwitcherModal: React.FC = () => {
  const {
    currentUser,
    savedAccounts,
    isAccountSwitcherOpen,
    setIsAccountSwitcherOpen,
    resumeSavedAccount,
    removeSavedAccountFromDevice,
    logout,
  } = useAuth();
  const { t } = usePreferences();

  const [switchingUserId, setSwitchingUserId] = useState<string | null>(null);
  const [accountToRemove, setAccountToRemove] = useState<SavedDeviceAccount | null>(null);
  const [notice, setNotice] = useState<{ type: 'error' | 'info' | 'success'; text: string } | null>(null);

  const handleSwitch = async (acc: SavedDeviceAccount) => {
    if (acc.userId === currentUser?.id) {
      setIsAccountSwitcherOpen(false);
      return;
    }
    setNotice(null);
    setSwitchingUserId(acc.userId);
    try {
      const res = await resumeSavedAccount(acc.userId);
      if (res.success) {
        setIsAccountSwitcherOpen(false);
      } else if (res.needsPassword) {
        setNotice({
          type: 'info',
          text:
            res.error
              ? t(res.error)
              : t(
                  'انتهت صلاحية الجلسة المحفوظة لهذا الحساب. اضغط «تسجيل الدخول بحساب آخر» لإدخال كلمة المرور بأمان.',
                  'The saved session for this account has expired. Click "Add / Sign In with Another Account" to enter your password safely.'
                ),
        });
      } else {
        setNotice({
          type: 'error',
          text: res.error ? t(res.error) : t('تعذر التبديل إلى الحساب المحدد.', 'Could not switch to the selected account.'),
        });
      }
    } finally {
      setSwitchingUserId(null);
    }
  };

  const handleConfirmRemove = async () => {
    if (!accountToRemove) return;
    const res = await removeSavedAccountFromDevice(accountToRemove.userId);
    setAccountToRemove(null);
    if (!res.serverRevoked && res.warning) {
      setNotice({ type: 'info', text: t(res.warning) });
    } else {
      setNotice({
        type: 'success',
        text: t(
          'تمت إزالة الحساب من هذا الجهاز دون التأثير على باقي الحسابات أو بيانات السيرفر.',
          'Account removed from this device without affecting other accounts or server data.'
        ),
      });
    }
  };

  const handleAddAccountLogin = async () => {
    setIsAccountSwitcherOpen(false);
    await logout();
  };

  return (
    <>
      <Modal
        isOpen={isAccountSwitcherOpen}
        onClose={() => {
          setNotice(null);
          setIsAccountSwitcherOpen(false);
        }}
        title={t('الحسابات المحفوظة على هذا الجهاز', 'Saved Accounts on This Device')}
        subtitle={t(
          'التبديل الآمن بين الحسابات المسجلة مسبقاً دون حفظ كلمات مرور نصية',
          'Switch safely between previously signed-in accounts without storing plain passwords'
        )}
        maxWidth="lg"
      >
        <div className="space-y-2 text-xs">
          <div className="p-2 rounded-lg bg-[#EEF3FA] border border-[#DCE6F5] flex items-center gap-2">
            <SavedAccountsIcon className="w-7 h-7 shrink-0" />
            <div className="text-[#011E58] leading-snug">
              <p className="font-black">{t('خزنة الحسابات المشفرة على الجهاز', 'Encrypted On-Device Account Vault')}</p>
              <p className="text-[11px] text-[#003589]">
                {t(
                  'كل حساب يحتفظ بجلسة وبيانات محلية معزولة تماماً، ولا تُحفظ كلمات المرور بشكل مكشوف مطلقاً.',
                  'Each account keeps an isolated local session and data, and plain-text passwords are never stored.'
                )}
              </p>
            </div>
          </div>

          {notice && (
            <div
              className={`p-2.5 rounded-lg border font-bold flex items-center gap-2 ${
                notice.type === 'error'
                  ? 'bg-red-50 border-red-200 text-red-800'
                  : notice.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              {notice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0" />
              )}
              <span>{notice.text}</span>
            </div>
          )}

          {savedAccounts.length === 0 ? (
            <div className="p-5 rounded-lg bg-slate-50 border border-slate-200 text-center space-y-1.5 text-slate-500">
              <Users className="w-7 h-7 mx-auto text-slate-400" />
              <p className="font-bold">{t('لا توجد حسابات محفوظة على هذا الجهاز حتى الآن.', 'No accounts saved on this device yet.')}</p>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-200 bg-white max-h-[52vh] overflow-y-auto">
              {savedAccounts.map((acc) => {
                const isCurrent = acc.userId === currentUser?.id;
                const isSwitching = switchingUserId === acc.userId;
                const canQuickResume = acc.sessionStatus === 'active' && Boolean(acc.refreshToken || acc.accessToken);
                return (
                  <div
                    key={acc.userId}
                    className={`px-2.5 py-1.5 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                      isCurrent ? 'bg-[#EEF3FA]/80' : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {acc.avatarPhoto ? (
                        <img
                          src={acc.avatarPhoto}
                          alt={acc.fullName}
                          className="w-8 h-8 rounded-md object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-md awlad-brand-gradient text-white font-black text-xs flex items-center justify-center shrink-0">
                          {(acc.fullName || acc.username || '?').trim().charAt(0)}
                        </div>
                      )}

                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-black text-xs text-slate-900 truncate">{acc.fullName}</span>
                          <span className="text-[11px] font-bold text-[#011E58]">
                            · {getRoleBadge(acc.role, t)}
                          </span>
                          {isCurrent && (
                            <span className="text-emerald-700 text-[11px] font-black inline-flex items-center gap-0.5">
                              · <ShieldCheck className="w-3 h-3" /> {t('نشط', 'Active')}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                          <span className="font-mono font-bold text-slate-700">@{acc.username}</span>
                          {acc.shopName && <span className="truncate">· {acc.shopName}</span>}
                          <span
                            className={`font-bold ${
                              acc.sessionStatus === 'active'
                                ? 'text-emerald-700'
                                : acc.sessionStatus === 'expired'
                                ? 'text-amber-800'
                                : 'text-slate-600'
                            }`}
                          >
                            ·{' '}
                            {acc.sessionStatus === 'active'
                              ? t('جلسة صالحة', 'Valid Session')
                              : acc.sessionStatus === 'expired'
                              ? t('يتطلب كلمة المرور', 'Password Required')
                              : t('تم تسجيل الخروج', 'Signed Out')}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 justify-end">
                      {!isCurrent && (
                        <button
                          type="button"
                          disabled={Boolean(switchingUserId)}
                          onClick={() => handleSwitch(acc)}
                          className={`h-8 px-2.5 rounded-md font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                            canQuickResume
                              ? 'bg-[#003589] hover:bg-[#011E58] text-white'
                              : 'bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300'
                          }`}
                        >
                          {isSwitching ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : canQuickResume ? (
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                          ) : (
                            <Lock className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {isSwitching
                              ? t('جاري التبديل...', 'Switching...')
                              : canQuickResume
                              ? t('التبديل للحساب', 'Switch Account')
                              : t('دخول', 'Sign In')}
                          </span>
                        </button>
                      )}

                      {!isCurrent && (
                        <button
                          type="button"
                          disabled={Boolean(switchingUserId)}
                          onClick={() => setAccountToRemove(acc)}
                          className="h-8 px-2 rounded-md bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 flex items-center gap-1 font-bold cursor-pointer"
                          title={t('إزالة هذا الحساب من الجهاز فقط', 'Remove this account from this device only')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{t('إزالة', 'Remove')}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleAddAccountLogin}
              className="h-8 px-2.5 rounded-md bg-[#003589] hover:bg-[#0049B0] text-white font-black flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('إضافة / دخول بحساب آخر', 'Add / Sign In with Another Account')}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsAccountSwitcherOpen(false)}
              className="h-8 px-3 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
            >
              {t('إغلاق', 'Close')}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(accountToRemove)}
        onClose={() => setAccountToRemove(null)}
        onConfirm={handleConfirmRemove}
        variant="danger"
        title={t('إزالة الحساب من هذا الجهاز؟', 'Remove account from this device?')}
        message={
          accountToRemove
            ? t(
                `سيتم مسح جلسة وبيانات (${accountToRemove.fullName}) المخزنة محلياً على هذا الجهاز فقط، ولن تتأثر بيانات الحساب على السيرفر المركزي.`,
                `Local session and data for (${accountToRemove.fullName}) will be cleared from this device only. Central server data will not be affected.`
              )
            : ''
        }
        confirmLabel={t('نعم، إزالة من الجهاز', 'Yes, Remove from Device')}
      />
    </>
  );
};

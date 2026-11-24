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
import { SavedDeviceAccount } from '../../../services/accountVault';
import { Modal } from '../../common/Modal';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { SavedAccountsIcon } from '../../common/AppIcons';

function getRoleArabicBadge(role: string): string {
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
            res.error ||
            'انتهت صلاحية الجلسة المحفوظة لهذا الحساب. اضغط «تسجيل الدخول بحساب آخر» لإدخال كلمة المرور بأمان.',
        });
      } else {
        setNotice({ type: 'error', text: res.error || 'تعذر التبديل إلى الحساب المحدد.' });
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
      setNotice({ type: 'info', text: res.warning });
    } else {
      setNotice({ type: 'success', text: 'تمت إزالة الحساب من هذا الجهاز دون التأثير على باقي الحسابات أو بيانات السيرفر.' });
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
        title="الحسابات المحفوظة على هذا الجهاز"
        subtitle="التبديل الآمن بين الحسابات المسجلة مسبقاً دون حفظ كلمات مرور نصية"
        maxWidth="lg"
      >
        <div className="space-y-2.5 text-xs">
          <div className="p-2.5 rounded-lg bg-blue-50/80 border border-blue-200 flex items-center gap-2.5">
            <SavedAccountsIcon className="w-8 h-8 shrink-0" />
            <div className="text-blue-950 leading-snug">
              <p className="font-black">خزنة الحسابات المشفرة على الجهاز</p>
              <p className="text-[11px] text-blue-800">
                كل حساب يحتفظ بجلسة وبيانات محلية معزولة تماماً، ولا تُحفظ كلمات المرور بشكل مكشوف مطلقاً.
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
              <p className="font-bold">لا توجد حسابات محفوظة على هذا الجهاز حتى الآن.</p>
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
                    className={`px-3 py-2 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                      isCurrent ? 'bg-blue-50/70' : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {acc.avatarPhoto ? (
                        <img
                          src={acc.avatarPhoto}
                          alt={acc.fullName}
                          className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-800 to-indigo-900 text-white font-black text-xs flex items-center justify-center shrink-0">
                          {(acc.fullName || acc.username || '؟').trim().charAt(0)}
                        </div>
                      )}

                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-black text-xs text-slate-900 truncate">{acc.fullName}</span>
                          <span className="text-[11px] font-bold text-blue-900">
                            · {getRoleArabicBadge(acc.role)}
                          </span>
                          {isCurrent && (
                            <span className="text-emerald-700 text-[11px] font-black inline-flex items-center gap-0.5">
                              · <ShieldCheck className="w-3 h-3" /> نشط
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
                              ? 'جلسة صالحة'
                              : acc.sessionStatus === 'expired'
                              ? 'يتطلب كلمة المرور'
                              : 'تم تسجيل الخروج'}
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
                          className={`min-h-[34px] px-2.5 rounded-lg font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                            canQuickResume
                              ? 'bg-blue-900 hover:bg-blue-950 text-white'
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
                          <span>{isSwitching ? 'جاري التبديل...' : canQuickResume ? 'التبديل للحساب' : 'دخول'}</span>
                        </button>
                      )}

                      {!isCurrent && (
                        <button
                          type="button"
                          disabled={Boolean(switchingUserId)}
                          onClick={() => setAccountToRemove(acc)}
                          className="min-h-[34px] px-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 flex items-center gap-1 font-bold cursor-pointer"
                          title="إزالة هذا الحساب من الجهاز فقط"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">إزالة</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="pt-2.5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleAddAccountLogin}
              className="min-h-[36px] px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-black flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة / دخول بحساب آخر</span>
            </button>
            <button
              type="button"
              onClick={() => setIsAccountSwitcherOpen(false)}
              className="min-h-[36px] px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
            >
              إغلاق
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(accountToRemove)}
        onClose={() => setAccountToRemove(null)}
        onConfirm={handleConfirmRemove}
        variant="danger"
        title="إزالة الحساب من هذا الجهاز؟"
        message={
          accountToRemove
            ? `سيتم مسح جلسة وبيانات (${accountToRemove.fullName}) المخزنة محلياً على هذا الجهاز فقط، ولن تتأثر بيانات الحساب على السيرفر المركزي.`
            : ''
        }
        confirmLabel="نعم، إزالة من الجهاز"
      />
    </>
  );
};

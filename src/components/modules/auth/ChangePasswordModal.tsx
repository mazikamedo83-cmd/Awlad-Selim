import React, { useState } from 'react';
import { Lock, KeyRound, Check, AlertCircle } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';

export const ChangePasswordModal: React.FC = () => {
  const { currentUser, updatePassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!currentUser?.mustChangePassword) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError('كلمة المرور الجديدة يجب أن تتكون من 6 خانات أو أحرف على الأقل');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين، يرجى إعادة التحقق');
      return;
    }

    setIsSubmitting(true);
    const res = await updatePassword(newPassword);
    setIsSubmitting(false);

    if (!res.success) {
      setError(res.error || 'تعذر تحديث كلمة المرور');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-950/80 backdrop-blur-md">
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-2xl border border-slate-200 text-right animate-in fade-in zoom-in duration-150">
        <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-900 flex items-center justify-center mx-auto mb-2.5 border border-blue-200 shadow-xs">
          <KeyRound className="w-5 h-5" />
        </div>

        <h3 className="text-base font-black text-slate-900 text-center mb-1">
          تعيين كلمة مرور جديدة إلزامي
        </h3>
        <p className="text-xs text-slate-500 text-center mb-3.5 leading-relaxed">
          لدواعي الأمان المالي، يطلب منك تعيين كلمة مرور شخصية جديدة وقوية قبل متابعة استخدام النظام.
        </p>

        {error && (
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 p-2.5 text-xs font-bold text-red-700 border border-red-200">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              كلمة المرور الجديدة:
            </label>
            <div className="relative">
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="أدخل كلمة مرور قوية (6 خانات فأكثر)"
                className="w-full rounded-lg border border-slate-300 py-2 px-3 text-xs focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden"
              />
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              تأكيد كلمة المرور الجديدة:
            </label>
            <div className="relative">
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="أعد إدخال كلمة المرور للتأكيد"
                className="w-full rounded-lg border border-slate-300 py-2 px-3 text-xs focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden"
              />
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 bg-blue-900 hover:bg-blue-950 text-white text-xs font-black rounded-lg shadow-sm transition-all disabled:opacity-50 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>{isSubmitting ? 'جاري الحفظ والتأمين...' : 'حفظ كلمة المرور والبدء بالعمل'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};

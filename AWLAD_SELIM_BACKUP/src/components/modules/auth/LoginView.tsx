import React, { useState } from 'react';
import { 
  Lock, User, Eye, EyeOff, ShieldCheck, AlertCircle 
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';

export const LoginView: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const result = await login(username, password);
    setIsLoading(false);

    if (!result.success) {
      setError(result.error || 'فشل تسجيل الدخول، يرجى المحاولة مرة أخرى');
    }
  };



  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden font-['Cairo']">
      {/* Decorative Background Elements */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-blue-600/10 blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-96 h-96 rounded-full bg-sky-500/10 blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden relative z-10 text-right animate-in fade-in duration-300">
        {/* Header / Logo banner */}
        <div className="bg-gradient-to-b from-blue-950 to-slate-900 p-8 text-center text-white relative">
          <img
            src="/awlad-selim-logo.png"
            alt="أولاد سليم AWLAD SELIM"
            className="max-h-24 mx-auto object-contain drop-shadow-md mb-3"
          />
          <h2 className="text-xl font-black tracking-tight text-white">
            نظام أولاد سليم للمحاسبة وإدارة الأعمال
          </h2>
          <p className="text-xs text-blue-200 mt-1 font-medium">
            بوابة تسجيل الدخول الآمن لتجارة المواد الغذائية بالجملة
          </p>
        </div>

        {/* Form Body */}
        <div className="p-6 sm:p-8 space-y-6">
          {error && (
            <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-bold text-red-700 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                اسم المستخدم:
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="أدخل اسم المستخدم"
                  className="w-full rounded-xl border border-slate-300 py-3 pr-10 pl-4 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all text-right"
                />
                <User className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5 pointer-events-none" />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  كلمة المرور:
                </label>
                <button
                  type="button"
                  onClick={() => setShowForgotModal(true)}
                  className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 transition-colors"
                >
                  نسيت كلمة المرور؟
                </button>
              </div>

              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="أدخل كلمة المرور"
                  className="w-full rounded-xl border border-slate-300 py-3 pr-10 pl-10 text-xs font-medium text-slate-800 placeholder-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-hidden transition-all text-right"
                />
                <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5 pointer-events-none" />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3.5 top-3.5 text-slate-400 hover:text-slate-600 focus:outline-hidden"
                  title={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 px-4 bg-blue-900 hover:bg-blue-950 text-white font-bold text-sm rounded-xl shadow-lg shadow-blue-900/25 transition-all active:scale-98 disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{isLoading ? 'جاري التحقق والمصادقة...' : 'دخول النظام'}</span>
            </button>
          </form>

        </div>

        {/* Footer */}
        <div className="bg-slate-50 border-t border-slate-100 px-6 py-3 text-center text-[11px] text-slate-500 font-medium">
          مؤسسة أولاد سليم لتجارة المواد الغذائية بالجملة • جميع الحقوق محفوظة 2026
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white rounded-2xl p-6 text-right shadow-2xl border border-slate-200">
            <h4 className="text-base font-bold text-slate-900 mb-2">استعادة كلمة المرور</h4>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              لإعادة ضبط كلمة المرور لأي حساب، يرجى التواصل مع مسؤول النظام.
            </p>
            <div className="p-3 bg-blue-50 text-blue-900 text-xs rounded-xl font-bold mb-4">
              لإعادة ضبط كلمة المرور، يرجى التواصل مع مسؤول النظام.
            </div>
            <button
              onClick={() => setShowForgotModal(false)}
              className="w-full py-2 bg-blue-900 text-white text-xs font-bold rounded-xl hover:bg-blue-950 transition-colors"
            >
              حسناً، فهمت
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

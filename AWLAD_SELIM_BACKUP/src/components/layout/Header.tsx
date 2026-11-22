import React, { useState } from 'react';
import { 
  LogOut, Menu, Maximize, Minimize, Bell, ArrowLeftRight, UserCheck, 
  ShieldCheck, AlertTriangle 
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { OfflineIndicator } from './OfflineIndicator';

interface HeaderProps {
  onToggleSidebar: () => void;
  onNavigateToTransfers?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onToggleSidebar, onNavigateToTransfers }) => {
  const { currentUser, logout } = useAuth();
  const { repTransfers, settings } = useData();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Check pending transfers
  const pendingTransfersCount = repTransfers.filter(t => t.status === 'awaiting_receipt').length;

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return <span className="bg-red-100 text-red-700 text-[11px] font-bold px-2 py-0.5 rounded-full border border-red-200">مالك / مدير عام</span>;
      case 'manager':
        return <span className="bg-blue-100 text-blue-700 text-[11px] font-bold px-2 py-0.5 rounded-full border border-blue-200">مدير فرع</span>;
      case 'accountant':
        return <span className="bg-emerald-100 text-emerald-700 text-[11px] font-bold px-2 py-0.5 rounded-full border border-emerald-200">محاسب مالي</span>;
      case 'customer':
        return <span className="bg-cyan-100 text-cyan-800 text-[11px] font-bold px-2 py-0.5 rounded-full border border-cyan-200">عميل</span>;
      case 'representative':
        return <span className="bg-amber-100 text-amber-800 text-[11px] font-bold px-2 py-0.5 rounded-full border border-amber-200">مندوب مبيعات</span>;
      case 'warehouse':
        return <span className="bg-purple-100 text-purple-700 text-[11px] font-bold px-2 py-0.5 rounded-full border border-purple-200">أمين مستودع</span>;
      default:
        return <span className="bg-slate-100 text-slate-700 text-[11px] font-bold px-2 py-0.5 rounded-full">موظف</span>;
    }
  };

  return (
    <>
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-xs px-4 sm:px-6 py-2.5 flex items-center justify-between no-print">
        {/* Left: Hamburger & Brand Title */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSidebar}
            className="p-2 rounded-xl text-slate-600 hover:text-blue-900 hover:bg-slate-100 transition-colors focus:outline-hidden"
            title="تبديل القائمة الجانبية"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 sm:gap-3">
            <img 
              src="/awlad-selim-logo.png" 
              alt="أولاد سليم" 
              className="h-9 sm:h-10 w-auto object-contain"
            />
            <div className="hidden sm:block">
              <h1 className="text-sm font-black text-blue-950 leading-tight">
                أولاد سليم – AWLAD SELIM
              </h1>
              <p className="text-[11px] text-slate-500 font-medium">
                نظام المحاسبة وإدارة الأعمال لتجارة المواد الغذائية
              </p>
            </div>
          </div>
        </div>

        {/* Right: Status, Alerts, User Profile & Logout */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Offline/Online Status Indicator */}
          <OfflineIndicator />

          {/* Pending Transfer Alert Button */}
          {pendingTransfersCount > 0 && onNavigateToTransfers && (
            <button
              onClick={onNavigateToTransfers}
              title={`يوجد ${pendingTransfersCount} طلب تحويل بالنصف معلق يحتاج تأكيد`}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-300 text-xs font-bold hover:bg-amber-100 transition-all animate-pulse"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-amber-600" />
              <span>طلب تحويل بالنصف</span>
              <span className="w-4 h-4 rounded-full bg-amber-600 text-white text-[10px] flex items-center justify-center font-mono">
                {pendingTransfersCount}
              </span>
            </button>
          )}

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="hidden md:flex p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            title="ملء الشاشة"
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>

          <div className="h-6 w-px bg-slate-200 hidden sm:block"></div>

          {/* User Info */}
          {currentUser && (
            <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
              <div className="w-8 h-8 rounded-lg bg-blue-900 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                {currentUser.fullName.slice(0, 2)}
              </div>
              <div className="hidden lg:block text-right">
                <span className="block text-xs font-bold text-slate-900 leading-tight">
                  {currentUser.fullName}
                </span>
                <div className="mt-0.5">
                  {getRoleBadge(currentUser.role)}
                </div>
              </div>
            </div>
          )}

          {/* Logout Button (Mandatory Requirement 24) */}
          <button
            onClick={() => setShowLogoutModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-red-600 hover:text-white hover:bg-red-600 border border-red-200 hover:border-red-600 transition-all text-xs font-bold shadow-xs active:scale-95"
            title="تسجيل الخروج من النظام"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">خروج</span>
          </button>
        </div>
      </header>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs no-print">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 text-right animate-in fade-in zoom-in duration-150">
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4 border border-red-100">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <h3 className="text-lg font-bold text-slate-900 text-center mb-1">
              هل تريد تسجيل الخروج؟
            </h3>
            <p className="text-xs text-slate-500 text-center mb-6 leading-relaxed">
              سيتم إنهاء جلستك الحالية والعودة لشاشة الدخول. لن يتم فقد أي بيانات تجارية أو فواتير محفوظة.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowLogoutModal(false);
                  logout();
                }}
                className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-md transition-colors"
              >
                نعم، تسجيل الخروج
              </button>
              <button
                type="button"
                onClick={() => setShowLogoutModal(false)}
                className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
              >
                إلغاء والعودة
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

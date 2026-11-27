import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '6xl' | '7xl';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = '2xl',
}) => {
  const { dir, t } = usePreferences();
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }
        onClose();
      }
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown, true);
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '6xl': 'max-w-6xl',
    '7xl': 'max-w-[96vw] xl:max-w-7xl',
  }[maxWidth];

  return (
    <div dir={dir} className="fixed inset-0 z-50 overflow-y-auto no-print">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-slate-900/60 dark:bg-[#040B17]/75 backdrop-blur-xs transition-opacity" 
        onClick={onClose} 
      />

      <div className="flex min-h-full items-center justify-center p-2 text-start">
        <div
          role="dialog"
          aria-modal="true"
          className={`relative w-full ${maxWidthClass} transform rounded-lg bg-white dark:bg-[#0E1C36] shadow-2xl transition-all border border-slate-200 dark:border-[#21375C] overflow-hidden`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--awlad-royal-700)]/20 dark:border-[#2A4D86] bg-[var(--awlad-navy-900)] dark:bg-[#132952] text-white px-3 py-2 gap-2">
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-black text-white truncate">{title}</h3>
              {subtitle && <p className="text-[11px] text-blue-100 mt-0.5 line-clamp-1">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 min-w-[28px] min-h-[28px] flex items-center justify-center text-white/80 hover:bg-white/15 hover:text-white transition-colors shrink-0 cursor-pointer"
              aria-label={t('إغلاق')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Content */}
          <div className="p-2.5 sm:p-3 max-h-[calc(92vh-48px)] overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

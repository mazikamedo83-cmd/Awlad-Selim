import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (inputValue?: string) => void | Promise<void>;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info' | 'success';
  requireInput?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  defaultInputValue?: string;
  isLoading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  requireInput = false,
  inputLabel,
  inputPlaceholder,
  defaultInputValue = '',
  isLoading = false,
}) => {
  const { t, dir } = usePreferences();
  const [inputValue, setInputValue] = useState(defaultInputValue);
  const [inputError, setInputError] = useState<string | null>(null);

  const effectiveConfirmLabel = confirmLabel ?? t('تأكيد', 'Confirm');
  const effectiveCancelLabel = cancelLabel ?? t('إلغاء', 'Cancel');
  const effectiveInputLabel = inputLabel ?? t('السبب / الملاحظة:', 'Reason / Note:');
  const effectiveInputPlaceholder = inputPlaceholder ?? t('اكتب التفاصيل هنا...', 'Enter details here...');

  useEffect(() => {
    if (isOpen) {
      setInputValue(defaultInputValue);
      setInputError(null);
    }
  }, [isOpen, defaultInputValue]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }
        if (!isLoading) onClose();
      }
    };
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const palette = {
    danger: {
      iconBg: 'bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-300 border-red-100 dark:border-red-500/30',
      btn: 'bg-red-600 hover:bg-red-700 text-white',
      Icon: AlertTriangle,
    },
    warning: {
      iconBg: 'bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-100 dark:border-amber-500/30',
      btn: 'bg-amber-600 hover:bg-amber-700 text-white',
      Icon: AlertTriangle,
    },
    info: {
      iconBg: 'bg-[#EEF3FA] dark:bg-[#16366B] text-[#003589] dark:text-[#85B8FF] border-[#DCE6F5] dark:border-[#2A436E]',
      btn: 'bg-[#003589] hover:bg-[#011E58] dark:bg-[#1659C8] dark:hover:bg-[#1F6BE6] text-white',
      Icon: Info,
    },
    success: {
      iconBg: 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-500/30',
      btn: 'bg-emerald-700 hover:bg-emerald-800 text-white',
      Icon: CheckCircle2,
    },
  }[variant];

  const Icon = palette.Icon;

  const handleConfirmClick = async (e: React.FormEvent) => {
    e.preventDefault();
    if (requireInput && !inputValue.trim()) {
      setInputError(t('يرجى إدخال البيان المطلوب قبل المتابعة.', 'Please enter the required details before continuing.'));
      return;
    }
    setInputError(null);
    await onConfirm(requireInput ? inputValue.trim() : undefined);
  };

  return (
    <div dir={dir} className="fixed inset-0 z-50 flex items-center justify-center p-2.5 bg-slate-900/60 dark:bg-[#040B17]/75 backdrop-blur-xs no-print">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-lg bg-white dark:bg-[#0E1C36] p-3 shadow-2xl border border-slate-200 dark:border-[#21375C] text-start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1.5">
          <div className={`w-8 h-8 rounded-md border flex items-center justify-center ${palette.iconBg}`}>
            <Icon className="w-4 h-4" />
          </div>
          <button
            type="button"
            disabled={isLoading}
            onClick={onClose}
            aria-label={t('إغلاق')}
            className="p-1 rounded-md text-slate-400 dark:text-[#849BBF] hover:bg-slate-100 dark:hover:bg-[#1A3461] hover:text-slate-600 dark:hover:text-[#F3F7FC] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <h3 className="text-sm font-black text-slate-900 dark:text-[#F3F7FC] mb-0.5">{t(title)}</h3>
        <p className="text-xs text-slate-600 dark:text-[#A9BCD9] leading-relaxed whitespace-pre-line">{t(message)}</p>

        <form onSubmit={handleConfirmClick} className="mt-2.5 space-y-2">
          {requireInput && (
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-[#CBD9EE] mb-1">{effectiveInputLabel}</label>
              <input
                type="text"
                autoFocus
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  if (inputError) setInputError(null);
                }}
                placeholder={effectiveInputPlaceholder}
                className="w-full border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-slate-900 dark:text-[#EEF4FC] rounded-md px-2.5 py-1.5 text-xs font-bold focus:outline-hidden focus:border-blue-700 dark:focus:border-[#3B82F6]"
              />
              {inputError && <p className="text-[11px] text-red-600 dark:text-red-400 font-bold mt-1">{inputError}</p>}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#21375C]">
            <button
              type="button"
              disabled={isLoading}
              onClick={onClose}
              className="px-3 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#132544] dark:hover:bg-[#1A3461] text-slate-700 dark:text-[#DCE6F5] border border-transparent dark:border-[#21375C] text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {effectiveCancelLabel}
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className={`px-3.5 py-1 rounded-md text-xs font-black shadow-xs cursor-pointer disabled:opacity-50 ${palette.btn}`}
            >
              {isLoading ? t('جاري التنفيذ...') : effectiveConfirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

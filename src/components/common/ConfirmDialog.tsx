import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

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
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  variant = 'danger',
  requireInput = false,
  inputLabel = 'السبب / الملاحظة:',
  inputPlaceholder = 'اكتب التفاصيل هنا...',
  defaultInputValue = '',
  isLoading = false,
}) => {
  const [inputValue, setInputValue] = useState(defaultInputValue);
  const [inputError, setInputError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setInputValue(defaultInputValue);
      setInputError(null);
    }
  }, [isOpen, defaultInputValue]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const palette = {
    danger: {
      iconBg: 'bg-red-50 text-red-600 border-red-100',
      btn: 'bg-red-600 hover:bg-red-700 text-white',
      Icon: AlertTriangle,
    },
    warning: {
      iconBg: 'bg-amber-50 text-amber-600 border-amber-100',
      btn: 'bg-amber-600 hover:bg-amber-700 text-white',
      Icon: AlertTriangle,
    },
    info: {
      iconBg: 'bg-[#EEF3FA] text-[#003589] border-[#DCE6F5]',
      btn: 'bg-[#003589] hover:bg-[#011E58] text-white',
      Icon: Info,
    },
    success: {
      iconBg: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      btn: 'bg-emerald-700 hover:bg-emerald-800 text-white',
      Icon: CheckCircle2,
    },
  }[variant];

  const Icon = palette.Icon;

  const handleConfirmClick = async (e: React.FormEvent) => {
    e.preventDefault();
    if (requireInput && !inputValue.trim()) {
      setInputError('يرجى إدخال البيان المطلوب قبل المتابعة.');
      return;
    }
    setInputError(null);
    await onConfirm(requireInput ? inputValue.trim() : undefined);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 bg-slate-900/60 backdrop-blur-xs no-print">
      <div
        className="w-full max-w-md rounded-lg bg-white p-3 shadow-2xl border border-slate-200 text-right"
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
            className="p-1 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <h3 className="text-sm font-black text-slate-900 mb-0.5">{title}</h3>
        <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{message}</p>

        <form onSubmit={handleConfirmClick} className="mt-2.5 space-y-2">
          {requireInput && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">{inputLabel}</label>
              <input
                type="text"
                autoFocus
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  if (inputError) setInputError(null);
                }}
                placeholder={inputPlaceholder}
                className="w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-xs font-bold focus:outline-hidden focus:border-blue-700"
              />
              {inputError && <p className="text-[11px] text-red-600 font-bold mt-1">{inputError}</p>}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              disabled={isLoading}
              onClick={onClose}
              className="px-3 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className={`px-3.5 py-1 rounded-md text-xs font-black shadow-xs cursor-pointer disabled:opacity-50 ${palette.btn}`}
            >
              {isLoading ? 'جاري التنفيذ...' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

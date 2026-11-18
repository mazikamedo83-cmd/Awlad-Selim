import React, { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { clampQuantity, formatQuantity, normalizeNumericText, parseQuantity, round3 } from '../../utils/quantity';

export interface QuantityInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  allowDecimals?: boolean;
  showSteppers?: boolean;
  onRemoveWhenZero?: () => void;
  ariaLabel?: string;
  inputClassName?: string;
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const QuantityInput: React.FC<QuantityInputProps> = ({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  allowDecimals = true,
  showSteppers = false,
  onRemoveWhenZero,
  ariaLabel = 'الكمية',
  inputClassName,
  className = '',
  inputRef,
  onKeyDown,
  disabled = false,
  placeholder,
}) => {
  const [text, setText] = useState<string>(() => formatQuantity(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setText(formatQuantity(value));
    }
  }, [value, isFocused]);

  const commitValue = (rawValue: string) => {
    const parsed = parseQuantity(rawValue, allowDecimals, min);
    const clamped = clampQuantity(parsed, min, max, allowDecimals);
    setText(formatQuantity(clamped));
    if (clamped !== value) {
      onChange(clamped);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const normalized = normalizeNumericText(e.target.value);
    const pattern = allowDecimals ? /^\d*(?:\.\d*)?$/ : /^\d*$/;
    if (!pattern.test(normalized)) return;

    setText(normalized);
    if (normalized === '' || normalized.endsWith('.')) return;

    const num = Number(normalized);
    if (!Number.isFinite(num)) return;

    const next = allowDecimals ? round3(num) : Math.round(num);
    if (max !== undefined && next > max) {
      onChange(max);
      return;
    }
    if (next >= min) {
      onChange(next);
    }
  };

  const handleDecrement = () => {
    if (disabled) return;
    const current = Number(value) || 0;
    const candidate = allowDecimals ? round3(current - step) : Math.round(current - step);
    if (candidate <= 0 && onRemoveWhenZero) {
      onRemoveWhenZero();
      return;
    }
    if (current <= min && onRemoveWhenZero) {
      onRemoveWhenZero();
      return;
    }
    const clamped = clampQuantity(candidate, min, max, allowDecimals);
    setText(formatQuantity(clamped));
    onChange(clamped);
  };

  const handleIncrement = () => {
    if (disabled) return;
    const current = Number(value) || 0;
    const candidate = allowDecimals ? round3(current + step) : Math.round(current + step);
    const clamped = clampQuantity(candidate, min, max, allowDecimals);
    setText(formatQuantity(clamped));
    onChange(clamped);
  };

  const defaultInputCls =
    'w-20 min-h-[40px] rounded-xl border border-slate-300 bg-white px-2 text-center text-xs font-bold font-mono text-slate-900 outline-hidden focus:border-blue-700 disabled:opacity-50';

  if (!showSteppers) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode={allowDecimals ? 'decimal' : 'numeric'}
        dir="ltr"
        value={text}
        onChange={handleInputChange}
        onFocus={(e) => {
          setIsFocused(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          setIsFocused(false);
          commitValue(text);
        }}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={inputClassName || defaultInputCls}
      />
    );
  }

  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={handleDecrement}
        disabled={disabled || (value <= min && !onRemoveWhenZero)}
        aria-label={`إنقاص ${ariaLabel}`}
        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold disabled:opacity-40 cursor-pointer"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      <input
        ref={inputRef}
        type="text"
        inputMode={allowDecimals ? 'decimal' : 'numeric'}
        dir="ltr"
        value={text}
        onChange={handleInputChange}
        onFocus={(e) => {
          setIsFocused(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          setIsFocused(false);
          commitValue(text);
        }}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={inputClassName || defaultInputCls}
      />

      <button
        type="button"
        onClick={handleIncrement}
        disabled={disabled || (max !== undefined && value >= max)}
        aria-label={`زيادة ${ariaLabel}`}
        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold disabled:opacity-40 cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

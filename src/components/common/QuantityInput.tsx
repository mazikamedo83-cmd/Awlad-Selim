import React, { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { parsePositiveQuantity, round3, sanitizeQuantityInput } from '../../utils/quantity';

interface QuantityInputProps {
  value: number;
  onChange: (nextQty: number) => void;
  min?: number;
  max?: number;
  step?: number;
  allowDecimals?: boolean;
  showSteppers?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  ariaLabel?: string;
  onRemoveWhenZero?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

export const QuantityInput: React.FC<QuantityInputProps> = ({
  value,
  onChange,
  min = 1,
  max,
  step = 1,
  allowDecimals = true,
  showSteppers = false,
  disabled = false,
  className = '',
  inputClassName = '',
  ariaLabel = 'الكمية',
  onRemoveWhenZero,
  inputRef: externalRef,
  onKeyDown,
}) => {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<string>(() => (Number.isFinite(value) ? String(value) : String(min)));
  const internalRef = useRef<HTMLInputElement>(null);
  const activeRef = externalRef || internalRef;

  useEffect(() => {
    if (!focused) {
      setDraft(Number.isFinite(value) ? String(value) : String(min));
    }
  }, [value, focused, min]);

  const commitDraft = (raw: string) => {
    const cleaned = sanitizeQuantityInput(raw, { allowDecimals });
    if (!cleaned || Number(cleaned) === 0) {
      if (onRemoveWhenZero && cleaned === '0') {
        onRemoveWhenZero();
        return;
      }
      const fallbackVal =
        min === 0
          ? 0
          : min > 0 && min < 1
          ? Number.isFinite(value) && value >= min
            ? value
            : 1
          : min >= 1
          ? min
          : 1;
      setDraft(String(fallbackVal));
      onChange(fallbackVal);
      return;
    }
    const parsed = parsePositiveQuantity(cleaned, {
      min,
      max,
      fallback: Number.isFinite(value) ? value : min,
      allowDecimals,
    });
    setDraft(String(parsed));
    onChange(parsed);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = sanitizeQuantityInput(e.target.value, { allowDecimals });
    setDraft(cleaned);

    if (cleaned === '' || cleaned.endsWith('.')) {
      return;
    }

    const numeric = Number.parseFloat(cleaned);
    if (Number.isFinite(numeric) && (numeric > 0 || (min === 0 && numeric === 0))) {
      const clamped =
        typeof max === 'number' && Number.isFinite(max) && numeric > max
          ? allowDecimals
            ? round3(max)
            : Math.floor(max)
          : allowDecimals
          ? round3(numeric)
          : Math.floor(numeric);
      if (clamped >= min) {
        onChange(clamped);
      }
    }
  };

  const handleStep = (delta: number) => {
    if (disabled) return;
    const base = Number.isFinite(value) ? value : min;
    const nextRaw = allowDecimals ? round3(base + delta) : Math.round(base + delta);
    if (nextRaw <= 0 && onRemoveWhenZero) {
      onRemoveWhenZero();
      return;
    }
    const next = parsePositiveQuantity(nextRaw, { min, max, fallback: min, allowDecimals });
    setDraft(String(next));
    onChange(next);
  };

  const inputEl = (
    <input
      ref={activeRef}
      type="text"
      inputMode={allowDecimals ? 'decimal' : 'numeric'}
      dir="ltr"
      aria-label={ariaLabel}
      disabled={disabled}
      value={focused ? draft : String(Number.isFinite(value) ? value : min)}
      onFocus={(e) => {
        setFocused(true);
        setDraft(Number.isFinite(value) ? String(value) : '');
        const el = e.currentTarget;
        window.setTimeout(() => {
          try {
            el.select();
          } catch {
            // ignore on browsers blocking select
          }
        }, 0);
      }}
      onChange={handleTextChange}
      onBlur={() => {
        setFocused(false);
        commitDraft(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commitDraft(draft);
          if (!onKeyDown) {
            e.preventDefault();
            activeRef.current?.blur();
          }
        }
        onKeyDown?.(e);
      }}
      className={
        inputClassName ||
        'w-16 min-h-[42px] rounded-xl border border-slate-300 bg-white px-2 text-center font-mono font-black text-sm text-slate-900 tabular-nums outline-hidden focus:border-blue-600 focus:ring-2 focus:ring-blue-500/15'
      }
    />
  );

  if (!showSteppers) {
    return inputEl;
  }

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => handleStep(-step)}
        aria-label="إنقاص الكمية"
        className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-black cursor-pointer disabled:opacity-45"
      >
        <Minus className="w-4 h-4" />
      </button>
      {inputEl}
      <button
        type="button"
        disabled={disabled}
        onClick={() => handleStep(step)}
        aria-label="زيادة الكمية"
        className="min-h-[42px] min-w-[42px] flex items-center justify-center rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-black cursor-pointer disabled:opacity-45"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
};

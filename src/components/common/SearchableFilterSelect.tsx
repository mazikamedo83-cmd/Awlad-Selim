import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';

export interface SearchableFilterOption {
  value: string;
  label: string;
  subtitle?: string;
  badge?: string;
  groupLabel?: string;
  searchText?: string;
  disabled?: boolean;
}

interface SearchableFilterSelectProps {
  id?: string;
  label?: string;
  inlinePrefix?: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchableFilterOption[];
  allOptionLabel?: string;
  allOptionValue?: string;
  includeAllOption?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  labelClassName?: string;
  dir?: 'rtl' | 'ltr';
  allowClear?: boolean;
  emptyText?: string;
  minPanelWidth?: number;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  onAfterSelect?: (value: string) => void;
  onValueSelected?: (value: string) => void;
}

export function normalizeArabicSearchText(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

export const SearchableFilterSelect: React.FC<SearchableFilterSelectProps> = ({
  id,
  label,
  inlinePrefix,
  value,
  onChange,
  options,
  allOptionLabel,
  allOptionValue = 'all',
  includeAllOption = true,
  placeholder,
  searchPlaceholder,
  disabled = false,
  className = '',
  buttonClassName = '',
  labelClassName = '',
  dir: dirProp,
  allowClear = false,
  emptyText,
  minPanelWidth = 240,
  triggerRef: externalTriggerRef,
  onAfterSelect,
  onValueSelected,
}) => {
  const { t, dir: activeDir } = usePreferences();
  const dir = dirProp ?? activeDir;
  const resolvedAllLabel = allOptionLabel ?? t('الكل', 'All');
  const resolvedPlaceholder = placeholder ?? t('اختر...', 'Select...');
  const resolvedSearchPlaceholder = searchPlaceholder ?? t('بحث بالاسم أو الكود...', 'Search by name or code...');
  const resolvedEmptyText = emptyText ?? t('لا توجد نتائج مطابقة', 'No matching results');
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [panelStyle, setPanelStyle] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
    placement: 'bottom' | 'top';
  }>({
    top: 0,
    left: 0,
    width: 260,
    maxHeight: 280,
    placement: 'bottom',
  });

  const internalTriggerRef = useRef<HTMLButtonElement>(null);
  const triggerRef = externalTriggerRef || internalTriggerRef;
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const normalizedOptions = useMemo(() => {
    const base: SearchableFilterOption[] = includeAllOption
      ? [{ value: allOptionValue, label: resolvedAllLabel, searchText: resolvedAllLabel }]
      : [];
    return [...base, ...options];
  }, [includeAllOption, allOptionValue, resolvedAllLabel, options]);

  const selectedOption = useMemo(() => {
    const exact = normalizedOptions.find((opt) => opt.value === value);
    if (exact) return exact;
    if (includeAllOption && (value === '' || value === allOptionValue)) {
      return normalizedOptions[0];
    }
    return undefined;
  }, [normalizedOptions, value, includeAllOption, allOptionValue]);

  const filteredOptions = useMemo(() => {
    const q = normalizeArabicSearchText(query);
    if (!q) return normalizedOptions;
    const tokens = q.split(' ').filter(Boolean);
    return normalizedOptions.filter((opt) => {
      const haystack = normalizeArabicSearchText(
        `${opt.label} ${opt.subtitle || ''} ${opt.badge || ''} ${opt.groupLabel || ''} ${opt.searchText || ''}`
      );
      return tokens.every((t) => haystack.includes(t));
    });
  }, [normalizedOptions, query]);

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const desiredWidth = Math.min(Math.max(rect.width, minPanelWidth), vw - margin * 2);

    let left = dir === 'rtl' ? rect.right - desiredWidth : rect.left;
    if (left + desiredWidth > vw - margin) {
      left = vw - desiredWidth - margin;
    }
    if (left < margin) {
      left = margin;
    }

    const spaceBelow = vh - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const preferTop = spaceBelow < 220 && spaceAbove > spaceBelow;
    const availableSpace = preferTop ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(160, Math.min(340, availableSpace - 6));

    if (preferTop) {
      setPanelStyle({
        bottom: vh - rect.top + 4,
        left,
        width: desiredWidth,
        maxHeight,
        placement: 'top',
      });
    } else {
      setPanelStyle({
        top: rect.bottom + 4,
        left,
        width: desiredWidth,
        maxHeight,
        placement: 'bottom',
      });
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    setQuery('');
    const currentIdx = filteredOptions.findIndex((o) => o.value === value && !o.disabled);
    setHighlightedIdx(currentIdx >= 0 ? currentIdx : 0);

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 10);

    const handleReposition = () => updatePosition();
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (highlightedIdx >= filteredOptions.length) {
      setHighlightedIdx(0);
    }
  }, [filteredOptions.length, highlightedIdx]);

  const selectValue = (nextVal: string) => {
    onChange(nextVal);
    onValueSelected?.(nextVal);
    setIsOpen(false);
    setQuery('');
    if (onAfterSelect) {
      window.setTimeout(() => onAfterSelect(nextVal), 20);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredOptions.length === 0) return;
      let next = (highlightedIdx + 1) % filteredOptions.length;
      let guard = 0;
      while (filteredOptions[next]?.disabled && guard < filteredOptions.length) {
        next = (next + 1) % filteredOptions.length;
        guard++;
      }
      setHighlightedIdx(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredOptions.length === 0) return;
      let prev = (highlightedIdx - 1 + filteredOptions.length) % filteredOptions.length;
      let guard = 0;
      while (filteredOptions[prev]?.disabled && guard < filteredOptions.length) {
        prev = (prev - 1 + filteredOptions.length) % filteredOptions.length;
        guard++;
      }
      setHighlightedIdx(prev);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = filteredOptions[highlightedIdx];
      if (chosen && !chosen.disabled) {
        selectValue(chosen.value);
      }
    }
  };

  const displayLabel = selectedOption ? selectedOption.label : resolvedPlaceholder;
  const showClear =
    allowClear &&
    !disabled &&
    value !== '' &&
    value !== allOptionValue &&
    includeAllOption;

  return (
    <div className={`relative ${className}`} dir={dir}>
      {label && (
        <label
          htmlFor={id}
          className={`block text-[11.5px] font-semibold text-slate-700 dark:text-[#CBD9EE] mb-1 leading-tight whitespace-nowrap ${labelClassName}`}
        >
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        className={`w-full h-8 px-2 rounded-md border text-[12px] flex items-center justify-between gap-1.5 transition-colors text-start ${
          disabled
            ? 'bg-slate-100 dark:bg-[#0B172E] border-slate-200 dark:border-[#1E3254] text-slate-400 dark:text-[#7C92B5] cursor-not-allowed'
            : isOpen
            ? 'bg-white dark:bg-[#10203D] border-[var(--awlad-royal-700)] dark:border-[#3B82F6] ring-2 ring-[var(--awlad-royal-500)]/20 dark:ring-[#3B82F6]/25 text-slate-900 dark:text-[#F3F7FC]'
            : 'bg-white dark:bg-[#10203D] border-slate-300 dark:border-[#2A436E] hover:border-[var(--awlad-silver-500)] dark:hover:border-[#3D6098] text-slate-800 dark:text-[#DCE6F5]'
        } ${buttonClassName}`}
        title={selectedOption?.subtitle ? `${displayLabel} — ${selectedOption.subtitle}` : displayLabel}
      >
        <span className="flex items-center gap-1 min-w-0 flex-1">
          {inlinePrefix && (
            <span className="text-[10.5px] font-bold text-slate-500 dark:text-[#8CA3C7] shrink-0 whitespace-nowrap">
              {inlinePrefix}:
            </span>
          )}
          <span className="truncate font-medium">{displayLabel}</span>
          {selectedOption?.badge && (
            <span className="shrink-0 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#172E56] text-[10px] font-semibold text-slate-600 dark:text-[#A9BCD9]">
              {selectedOption.badge}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {showClear && (
            <span
              role="button"
              tabIndex={-1}
              aria-label={t('مسح الاختيار', 'Clear selection')}
              onClick={(e) => {
                e.stopPropagation();
                onChange(allOptionValue);
              }}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-[#1A3461] text-slate-400 dark:text-[#849BBF] hover:text-slate-700 dark:hover:text-[#F3F7FC]"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-500 dark:text-[#849BBF] transition-transform ${
              isOpen ? 'rotate-180 text-[var(--awlad-royal-700)] dark:text-[#85B8FF]' : ''
            }`}
          />
        </span>
      </button>

      {isOpen &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div
            ref={panelRef}
            dir={dir}
            role="listbox"
            style={{
              position: 'fixed',
              top: panelStyle.top,
              bottom: panelStyle.bottom,
              left: panelStyle.left,
              width: panelStyle.width,
              maxHeight: panelStyle.maxHeight,
              zIndex: 95,
            }}
            className="bg-white dark:bg-[#0E1C36] border border-slate-300 dark:border-[#2A436E] rounded-lg shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="p-2 border-b border-slate-200 dark:border-[#21375C] bg-slate-50/80 dark:bg-[#132544] shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 dark:text-[#849BBF] absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlightedIdx(0);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={resolvedSearchPlaceholder}
                  className="w-full h-8 ps-8 pe-7 text-xs rounded-md border border-slate-300 dark:border-[#2A436E] bg-white dark:bg-[#10203D] text-slate-800 dark:text-[#EEF4FC] dark:placeholder-[#7F96BA] focus:outline-none focus:border-[var(--awlad-royal-700)] dark:focus:border-[#3B82F6]"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#849BBF] hover:text-slate-600 dark:hover:text-[#F3F7FC]"
                    aria-label={t('مسح البحث', 'Clear search')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-y-auto flex-1 py-1">
              {filteredOptions.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-slate-500 dark:text-[#97AECE]">
                  {resolvedEmptyText}
                </div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const prevGroup = idx > 0 ? filteredOptions[idx - 1]?.groupLabel : undefined;
                  const showGroupHeader = opt.groupLabel && opt.groupLabel !== prevGroup;
                  const isSelected = opt.value === value;
                  const isHighlighted = idx === highlightedIdx;

                  return (
                    <React.Fragment key={`${opt.groupLabel || 'g'}-${opt.value}-${idx}`}>
                      {showGroupHeader && (
                        <div className="sticky top-0 z-10 px-3 py-1 text-[10.5px] font-bold bg-slate-100/95 dark:bg-[#172E56] text-slate-600 dark:text-[#A9BCD9] border-y border-slate-200/70 dark:border-[#21375C]">
                          {opt.groupLabel}
                        </div>
                      )}
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        disabled={opt.disabled}
                        onMouseEnter={() => setHighlightedIdx(idx)}
                        onClick={() => {
                          if (!opt.disabled) selectValue(opt.value);
                        }}
                        className={`w-full px-3 py-1.5 text-start flex items-center justify-between gap-2 text-xs transition-colors ${
                          opt.disabled
                            ? 'opacity-45 cursor-not-allowed'
                            : isSelected
                            ? 'bg-[var(--awlad-blue-tint-50)] dark:bg-[#16366B] text-[var(--awlad-navy-900)] dark:text-[#85B8FF] font-bold'
                            : isHighlighted
                            ? 'bg-slate-100 dark:bg-[#1A3461] text-slate-900 dark:text-[#F3F7FC]'
                            : 'text-slate-800 dark:text-[#DCE6F5] hover:bg-slate-50 dark:hover:bg-[#1A3461]'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{opt.label}</div>
                          {opt.subtitle && (
                            <div className="text-[10.5px] text-slate-500 dark:text-[#97AECE] truncate">
                              {opt.subtitle}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {opt.badge && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#132544] text-[10px] font-semibold text-slate-600 dark:text-[#A9BCD9] border border-slate-200 dark:border-[#2A436E]">
                              {opt.badge}
                            </span>
                          )}
                          {isSelected && <Check className="w-3.5 h-3.5 text-[var(--awlad-royal-700)] dark:text-[#60A5FA] shrink-0" />}
                        </div>
                      </button>
                    </React.Fragment>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default SearchableFilterSelect;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { ChevronDown, Check, Plus, Pencil, Search, X } from 'lucide-react';
import { normalizeArabicSearchText } from './SearchableFilterSelect';

export interface TaxonomyOptionItem {
  id: string;
  name: string;
  subtitle?: string;
  status?: 'active' | 'suspended';
}

interface SearchableTaxonomySelectProps {
  label?: string;
  required?: boolean;
  items: TaxonomyOptionItem[];
  valueId?: string;
  valueText?: string;
  onChange: (next: { id?: string; name: string }) => void;
  onCreate?: (name: string) => Promise<{ success: boolean; item?: TaxonomyOptionItem; error?: string }>;
  onRename?: (id: string, newName: string) => Promise<{ success: boolean; error?: string }>;
  allowManualText?: boolean;
  allowClear?: boolean;
  emptyDisplayText?: string;
  clearLabel?: string;
  createLabel?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  compact?: boolean;
  triggerClassName?: string;
}

export const SearchableTaxonomySelect: React.FC<SearchableTaxonomySelectProps> = ({
  label,
  required = false,
  items,
  valueId = '',
  valueText = '',
  onChange,
  onCreate,
  onRename,
  allowManualText = false,
  allowClear = false,
  emptyDisplayText = '—',
  clearLabel = 'بدون',
  createLabel = 'إضافة جديد',
  searchPlaceholder = 'بحث بالاسم أو جزء منه...',
  disabled = false,
  compact = false,
  triggerClassName = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 260, maxHeight: 320 });
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedItem = useMemo(() => {
    if (valueId) {
      const byId = items.find((it) => it.id === valueId);
      if (byId) return byId;
    }
    if (valueText.trim()) {
      const normVal = normalizeArabicSearchText(valueText);
      return items.find((it) => normalizeArabicSearchText(it.name) === normVal) || null;
    }
    return null;
  }, [items, valueId, valueText]);

  const displayValue = selectedItem?.name || valueText.trim() || '';

  const filteredItems = useMemo(() => {
    const q = normalizeArabicSearchText(search);
    if (!q) return items;
    const tokens: string[] = q.split(' ').filter(Boolean);
    return items.filter((it) => {
      const hay = normalizeArabicSearchText(`${it.name} ${it.subtitle || ''}`);
      return tokens.every((tok: string) => hay.includes(tok));
    });
  }, [items, search]);

  const exactMatchExists = useMemo(() => {
    const q = normalizeArabicSearchText(search);
    if (!q) return false;
    return items.some((it) => normalizeArabicSearchText(it.name) === q);
  }, [items, search]);

  const updatePosition = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const minWidth = Math.max(rect.width, 240);
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(340, Math.max(180, openUp ? spaceAbove : spaceBelow));
    const clampedLeft = Math.min(
      Math.max(8, rect.left),
      Math.max(8, window.innerWidth - minWidth - 8)
    );
    setCoords({
      top: openUp ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4,
      left: clampedLeft,
      width: minWidth,
      maxHeight,
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 10);

    const handleReposition = () => updatePosition();
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    document.addEventListener('mousedown', handleOutside);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSearch('');
      setIsCreating(false);
      setNewName('');
      setEditingId(null);
      setEditingName('');
      setActionError('');
    }
  }, [isOpen]);

  const handleSelectItem = (item: TaxonomyOptionItem) => {
    onChange({ id: item.id, name: item.name });
    setIsOpen(false);
  };

  const handleCreateSubmit = async (candidateRaw?: string) => {
    const cleanName = String(candidateRaw ?? newName).trim();
    if (!cleanName || busy) return;
    setActionError('');
    if (!onCreate) {
      if (allowManualText) {
        onChange({ id: undefined, name: cleanName });
        setIsOpen(false);
      }
      return;
    }
    setBusy(true);
    try {
      const res = await onCreate(cleanName);
      if (res.success && res.item) {
        onChange({ id: res.item.id, name: res.item.name });
        setIsOpen(false);
      } else {
        setActionError(res.error || 'تعذر الإضافة');
      }
    } catch (err: any) {
      setActionError(err?.message || 'تعذر الإضافة');
    } finally {
      setBusy(false);
    }
  };

  const handleRenameSubmit = async () => {
    if (!editingId || !onRename || busy) return;
    const cleanName = editingName.trim();
    if (!cleanName) {
      setActionError('الاسم مطلوب');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const res = await onRename(editingId, cleanName);
      if (res.success) {
        if (selectedItem?.id === editingId || valueId === editingId) {
          onChange({ id: editingId, name: cleanName });
        }
        setEditingId(null);
        setEditingName('');
      } else {
        setActionError(res.error || 'تعذر التعديل');
      }
    } catch (err: any) {
      setActionError(err?.message || 'تعذر التعديل');
    } finally {
      setBusy(false);
    }
  };

  const trimmedSearch = search.trim();

  return (
    <div ref={containerRef} className="relative w-full">
      {label && (
        <label className="block text-xs font-semibold text-gray-700 mb-1">
          {label} {required ? <span className="text-red-500">*</span> : null}
        </label>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 text-right border border-gray-300 rounded-lg bg-white text-gray-900 transition-colors ${
          compact ? 'px-2.5 py-1.5 text-xs min-h-[32px]' : 'px-3 py-2 text-sm min-h-[38px]'
        } ${disabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'hover:border-[#003589] focus:outline-none focus:ring-2 focus:ring-[#003589]/25'} ${triggerClassName}`}
      >
        <span className={`truncate ${displayValue ? 'font-medium text-gray-900' : 'text-gray-400'}`}>
          {displayValue || emptyDisplayText}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {allowManualText && !selectedItem && valueText.trim() && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-[#003589] font-semibold">
              يدوي
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {isOpen &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div
            ref={dropdownRef}
            dir="rtl"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
              zIndex: 99999,
            }}
            className="bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Instant Search Bar */}
            <div className="p-2 border-b border-gray-100 bg-gray-50">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setIsOpen(false);
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      if (filteredItems.length === 1 && !editingId && !isCreating) {
                        handleSelectItem(filteredItems[0]);
                      } else if (trimmedSearch && !exactMatchExists && allowManualText && !onCreate) {
                        onChange({ id: undefined, name: trimmedSearch });
                        setIsOpen(false);
                      }
                    }
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full pr-8 pl-7 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#003589]"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute left-2 text-gray-400 hover:text-gray-600"
                    title="مسح البحث"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {actionError && (
              <div className="px-2.5 py-1.5 bg-red-50 border-b border-red-200 text-red-700 text-[11px] font-medium">
                {actionError}
              </div>
            )}

            {/* Quick Use / Create Typed Value */}
            {trimmedSearch && !exactMatchExists && (allowManualText || onCreate) && (
              <div className="p-1.5 border-b border-blue-100 bg-blue-50/70 flex flex-wrap gap-1.5">
                {allowManualText && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onChange({ id: undefined, name: trimmedSearch });
                      setIsOpen(false);
                    }}
                    className="flex-1 text-right px-2 py-1 rounded-md text-xs font-medium bg-white border border-blue-200 text-[#003589] hover:bg-blue-100/60"
                  >
                    استخدام &quot;{trimmedSearch}&quot;
                  </button>
                )}
                {onCreate && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleCreateSubmit(trimmedSearch)}
                    className="flex-1 text-right px-2 py-1 rounded-md text-xs font-semibold bg-[#003589] text-white hover:bg-[#011E58] flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">إضافة &quot;{trimmedSearch}&quot;</span>
                  </button>
                )}
              </div>
            )}

            {/* Items List */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {allowClear && (
                <button
                  type="button"
                  onClick={() => {
                    onChange({ id: undefined, name: '' });
                    setIsOpen(false);
                  }}
                  className={`w-full text-right px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between ${
                    !displayValue ? 'bg-blue-50/60 font-semibold text-[#003589]' : 'text-gray-600'
                  }`}
                >
                  <span>{clearLabel}</span>
                  {!displayValue && <Check className="w-3.5 h-3.5 text-[#003589]" />}
                </button>
              )}

              {filteredItems.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-gray-500">
                  {items.length === 0 ? 'لا توجد عناصر مسجلة بعد' : 'لا توجد نتائج مطابقة'}
                </div>
              ) : (
                filteredItems.map((item) => {
                  const isSelected =
                    (valueId && item.id === valueId) ||
                    (!valueId && valueText.trim() && normalizeArabicSearchText(item.name) === normalizeArabicSearchText(valueText));

                  if (editingId === item.id) {
                    return (
                      <div key={item.id} className="p-2 bg-amber-50/70 flex items-center gap-1.5">
                        <input
                          type="text"
                          autoFocus
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void handleRenameSubmit();
                            } else if (e.key === 'Escape') {
                              setEditingId(null);
                            }
                          }}
                          className="flex-1 px-2 py-1 text-xs border border-amber-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-[#003589]"
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleRenameSubmit()}
                          className="px-2 py-1 rounded bg-[#003589] text-white text-[11px] font-semibold hover:bg-[#011E58]"
                        >
                          حفظ
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-1.5 py-1 rounded border border-gray-300 bg-white text-[11px] text-gray-600"
                        >
                          إلغاء
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 text-xs transition-colors ${
                        isSelected ? 'bg-blue-50 text-[#003589] font-semibold' : 'text-gray-800 hover:bg-gray-50'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectItem(item)}
                        className="flex-1 text-right py-0.5 flex items-center gap-1.5 min-w-0"
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 text-[#003589] shrink-0" />}
                        <span className="truncate">{item.name}</span>
                        {item.subtitle && (
                          <span className="text-[10px] text-gray-400 truncate">({item.subtitle})</span>
                        )}
                        {item.status === 'suspended' && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 shrink-0">
                            موقوف
                          </span>
                        )}
                      </button>
                      {onRename && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(item.id);
                            setEditingName(item.name);
                            setActionError('');
                          }}
                          className="p-1 text-gray-400 hover:text-[#003589] rounded hover:bg-blue-50 shrink-0"
                          title="تعديل الاسم"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Add New Inline Box */}
            {onCreate && (
              <div className="p-2 border-t border-gray-100 bg-gray-50">
                {!isCreating ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreating(true);
                      setNewName(trimmedSearch || '');
                      setActionError('');
                    }}
                    className="w-full py-1.5 px-2 rounded-lg border border-dashed border-[#003589]/50 text-[#003589] hover:bg-blue-50 text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{createLabel}</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleCreateSubmit();
                        } else if (e.key === 'Escape') {
                          setIsCreating(false);
                        }
                      }}
                      className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-[#003589]"
                    />
                    <button
                      type="button"
                      disabled={busy || !newName.trim()}
                      onClick={() => void handleCreateSubmit()}
                      className="px-2.5 py-1 rounded bg-[#003589] text-white text-[11px] font-semibold hover:bg-[#011E58] disabled:opacity-50"
                    >
                      حفظ
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreating(false)}
                      className="px-1.5 py-1 rounded border border-gray-300 bg-white text-[11px] text-gray-600"
                    >
                      إلغاء
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};

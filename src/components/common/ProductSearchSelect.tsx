import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Search, X, Package, ChevronDown } from 'lucide-react';
import { Product, Warehouse } from '../../types';

function normalizeSearchText(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F\u0670]/g, '') // Arabic diacritics
    .replace(/\s+/g, ' ');
}

interface ProductSearchSelectProps {
  products: Product[];
  selectedProductId: string;
  onSelect: (product: Product) => void;
  onAfterSelect?: () => void;
  warehouseId?: string;
  warehouses?: Warehouse[];
  priceMode?: 'selling' | 'purchase';
  currency?: string;
  placeholder?: string;
  excludeProductIds?: string[];
  allowInactive?: boolean;
  inputId?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  clearOnSelect?: boolean;
  className?: string;
}

export const ProductSearchSelect: React.FC<ProductSearchSelectProps> = ({
  products,
  selectedProductId,
  onSelect,
  onAfterSelect,
  warehouseId,
  warehouses = [],
  priceMode = 'selling',
  currency = 'ج.م',
  placeholder = 'ابحث باسم الصنف (عربي/إنجليزي) أو الكود أو الباركود...',
  excludeProductIds = [],
  allowInactive = false,
  inputId,
  inputRef: externalInputRef,
  disabled = false,
  clearOnSelect = false,
  className = '',
}) => {
  const internalInputRef = useRef<HTMLInputElement | null>(null);
  const inputElRef = externalInputRef || internalInputRef;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  const warehouseName = useMemo(() => {
    if (!warehouseId) return 'جميع المخازن';
    return warehouses.find((w) => w.id === warehouseId)?.name || 'المخزن المحدد';
  }, [warehouseId, warehouses]);

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const [panelStyle, setPanelStyle] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  }>({
    top: 0,
    left: 0,
    width: 320,
    maxHeight: 288,
  });

  const updatePosition = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const desiredWidth = Math.min(Math.max(rect.width, 300), vw - margin * 2);

    let left = rect.right - desiredWidth;
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
    const maxHeight = Math.max(150, Math.min(288, availableSpace - 8));

    if (preferTop) {
      setPanelStyle({
        bottom: vh - rect.top + 6,
        left,
        width: desiredWidth,
        maxHeight,
      });
    } else {
      setPanelStyle({
        top: rect.bottom + 6,
        left,
        width: desiredWidth,
        maxHeight,
      });
    }
  }, []);

  // Sync display text when closed or when selectedProductId changes externally
  useEffect(() => {
    if (!isOpen) {
      if (selectedProduct && !clearOnSelect) {
        setQuery(`${selectedProduct.name} (${selectedProduct.code})`);
      } else {
        setQuery('');
      }
    }
  }, [selectedProduct, isOpen, clearOnSelect]);

  // Reposition portal on open / scroll / resize and close on outside pointer down
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const handleReposition = () => updatePosition();
    const handleOutside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current?.contains(target) ||
        listRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    document.addEventListener('pointerdown', handleOutside);
    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
      document.removeEventListener('pointerdown', handleOutside);
    };
  }, [isOpen, updatePosition]);

  const getProductStock = (p: Product): number => {
    if (warehouseId) {
      return Number(p.stockPerWarehouse?.[warehouseId] || 0);
    }
    return Object.values(p.stockPerWarehouse || {}).reduce((acc, q) => acc + Number(q || 0), 0);
  };

  const getProductWarehouseDisplay = (p: Product): string => {
    if (warehouseId) {
      return warehouseName;
    }
    const entries = Object.entries(p.stockPerWarehouse || {}).filter(([, q]) => Number(q) > 0);
    if (entries.length === 0) return 'لا يوجد رصيد';
    if (entries.length === 1) {
      return warehouses.find((w) => w.id === entries[0][0])?.name || 'مخزن';
    }
    return `${entries.length} مخازن`;
  };

  const filteredProducts = useMemo(() => {
    const excluded = new Set(excludeProductIds);
    const activeList = products.filter((p) => {
      if (!allowInactive && p.status !== 'active') return false;
      if (excluded.has(p.id)) return false;
      return true;
    });

    const normQ = normalizeSearchText(query);
    // If query exactly matches currently selected label on initial open, show full list so user can browse or type to filter
    const selectedDisplay = selectedProduct ? normalizeSearchText(`${selectedProduct.name} (${selectedProduct.code})`) : '';
    if (!normQ || (isOpen && selectedProduct && normQ === selectedDisplay)) {
      return activeList.slice(0, 60);
    }

    const tokens = normQ.split(' ').filter(Boolean);
    const matched = activeList
      .map((p) => {
        const unitBarcodes = (p.units || []).map((u) => u.barcode || '').join(' ');
        const haystack = normalizeSearchText(
          `${p.name} ${p.code} ${p.barcode || ''} ${unitBarcodes} ${p.category || ''}`
        );
        const matchesAll = tokens.every((tk) => haystack.includes(tk));
        if (!matchesAll) return null;

        // Prioritize exact barcode/code match, then startsWith name
        let score = 0;
        if (normalizeSearchText(p.barcode || '') === normQ || normalizeSearchText(p.code) === normQ) {
          score = 100;
        } else if (normalizeSearchText(p.name).startsWith(normQ)) {
          score = 50;
        } else {
          score = 10;
        }
        return { p, score };
      })
      .filter((x): x is { p: Product; score: number } => Boolean(x))
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map((x) => x.p);

    return matched;
  }, [products, query, excludeProductIds, allowInactive, selectedProduct, isOpen]);

  useEffect(() => {
    setHighlightedIdx(0);
  }, [query, isOpen]);

  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const itemEl = listRef.current.querySelector(`[data-idx="${highlightedIdx}"]`) as HTMLElement | null;
    if (itemEl) {
      itemEl.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIdx, isOpen]);

  const handleOpen = () => {
    if (disabled) return;
    setIsOpen(true);
    // Clear selected preview text when focusing so typing starts fresh immediately
    if (selectedProduct && query === `${selectedProduct.name} (${selectedProduct.code})`) {
      setQuery('');
    }
  };

  const commitSelection = (product: Product) => {
    onSelect(product);
    setIsOpen(false);
    if (clearOnSelect) {
      setQuery('');
    } else {
      setQuery(`${product.name} (${product.code})`);
    }
    if (onAfterSelect) {
      window.setTimeout(() => onAfterSelect(), 20);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      handleOpen();
      return;
    }
    if (!isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx((prev) => (filteredProducts.length > 0 ? (prev + 1) % filteredProducts.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx((prev) =>
        filteredProducts.length > 0 ? (prev - 1 + filteredProducts.length) % filteredProducts.length : 0
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // If exact barcode match exists, prioritize it even if highlighted differs
      const normQ = normalizeSearchText(query);
      const exactBarcode = filteredProducts.find(
        (p) => normalizeSearchText(p.barcode || '') === normQ || normalizeSearchText(p.code) === normQ
      );
      const target = exactBarcode || filteredProducts[highlightedIdx];
      if (target) {
        commitSelection(target);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setIsOpen(false);
      if (selectedProduct && !clearOnSelect) {
        setQuery(`${selectedProduct.name} (${selectedProduct.code})`);
      } else {
        setQuery('');
      }
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <Search className="w-4 h-4 text-slate-400 absolute right-3 pointer-events-none" />
        <input
          ref={inputElRef as React.RefObject<HTMLInputElement>}
          id={inputId}
          type="text"
          disabled={disabled}
          value={query}
          onFocus={handleOpen}
          onClick={handleOpen}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full pr-9 pl-14 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-hidden focus:border-blue-700 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:cursor-not-allowed"
        />
        <div className="absolute left-2 flex items-center gap-1">
          {(query || selectedProductId) && !disabled && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery('');
                setIsOpen(true);
                inputElRef.current?.focus();
              }}
              className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
              title="مسح البحث"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown
            onMouseDown={(e) => {
              e.preventDefault();
              if (disabled) return;
              if (isOpen) {
                setIsOpen(false);
              } else {
                handleOpen();
                inputElRef.current?.focus();
              }
            }}
            className={`w-4 h-4 text-slate-400 transition-transform cursor-pointer ${isOpen ? 'rotate-180 text-blue-700' : ''}`}
          />
        </div>
      </div>

      {isOpen &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div
            ref={listRef}
            dir="rtl"
            style={{
              position: 'fixed',
              top: panelStyle.top,
              bottom: panelStyle.bottom,
              left: panelStyle.left,
              width: panelStyle.width,
              maxHeight: panelStyle.maxHeight,
              zIndex: 100,
            }}
            className="overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl divide-y divide-slate-100"
          >
          {filteredProducts.length === 0 ? (
            <div className="p-3 text-center text-xs text-slate-500">
              <Package className="w-5 h-5 text-slate-300 mx-auto mb-1" />
              لا توجد أصناف مطابقة للبحث "{query}"
            </div>
          ) : (
            filteredProducts.map((p, idx) => {
              const stockQty = getProductStock(p);
              const price = priceMode === 'purchase' ? p.purchasePrice : p.sellingPrice;
              const isHighlighted = idx === highlightedIdx;
              const isSelected = p.id === selectedProductId;

              return (
                <button
                  key={p.id}
                  type="button"
                  data-idx={idx}
                  onMouseEnter={() => setHighlightedIdx(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commitSelection(p);
                  }}
                  className={`w-full px-3 py-1.5 text-right flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                    isHighlighted
                      ? 'bg-blue-50 text-blue-950'
                      : isSelected
                      ? 'bg-emerald-50/70'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black text-slate-900 truncate">{p.name}</span>
                      <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold">
                        {p.code}
                      </span>
                      {p.barcode && (
                        <span className="text-[10px] font-mono text-slate-400">#{p.barcode}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5 flex-wrap">
                      <span>{p.category}</span>
                      <span>•</span>
                      <span>الوحدة: {p.baseUnit}</span>
                      <span>•</span>
                      <span className="text-slate-600 font-semibold">{getProductWarehouseDisplay(p)}</span>
                    </div>
                  </div>

                  <div className="text-left shrink-0 space-y-0.5">
                    <div className="text-xs font-black text-blue-900 font-mono">
                      {Number(price || 0).toLocaleString()} {currency}
                    </div>
                    <div
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded inline-block ${
                        stockQty <= 0
                          ? 'bg-red-100 text-red-700'
                          : stockQty <= (p.minStockLevel || 0)
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      المتاح: {stockQty} {p.baseUnit}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>,
          document.body
        )}
    </div>
  );
};

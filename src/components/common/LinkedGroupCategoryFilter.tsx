import React, { useMemo, useRef } from 'react';
import { Product, ProductCategory, ProductGroup } from '../../types';
import { usePreferences } from '../../context/PreferencesContext';
import { SearchableFilterSelect, SearchableFilterOption } from './SearchableFilterSelect';

export function getScopedCategoriesForGroup(
  categories: ProductCategory[],
  groupId: string,
  includeSuspended = false
): ProductCategory[] {
  const activeFiltered = categories.filter((c) => includeSuspended || c.status !== 'suspended');
  if (!groupId || groupId === 'all') {
    return activeFiltered;
  }
  return activeFiltered.filter((c) => (c.groupId || '') === groupId);
}

export function filterProductsByGroupCategory(
  products: Product[],
  productGroups: ProductGroup[],
  categories: ProductCategory[],
  groupId: string,
  categoryValue: string
): Product[] {
  const hasGroup = Boolean(groupId && groupId !== 'all');
  const hasCat = Boolean(categoryValue && categoryValue !== 'all');
  if (!hasGroup && !hasCat) return products;

  const selectedGroup = hasGroup ? productGroups.find((g) => g.id === groupId) : undefined;
  const groupCategoryIds = hasGroup
    ? new Set(categories.filter((c) => (c.groupId || '') === groupId).map((c) => c.id))
    : new Set<string>();
  const groupCategoryNames = hasGroup
    ? new Set(categories.filter((c) => (c.groupId || '') === groupId).map((c) => c.name))
    : new Set<string>();

  const selectedCatObj = hasCat
    ? categories.find((c) => c.id === categoryValue) ||
      categories.find((c) => (!hasGroup || (c.groupId || '') === groupId) && c.name === categoryValue)
    : undefined;

  return products.filter((p) => {
    if (hasGroup) {
      const matchDirectGroup =
        p.groupId === groupId || (!p.groupId && selectedGroup && p.groupName === selectedGroup.name);
      const matchViaCat =
        (p.categoryId && groupCategoryIds.has(p.categoryId)) ||
        (!p.categoryId && !p.groupId && p.category && groupCategoryNames.has(p.category));
      if (!matchDirectGroup && !matchViaCat) return false;
    }

    if (hasCat) {
      if (selectedCatObj) {
        if (p.categoryId) {
          if (p.categoryId !== selectedCatObj.id) return false;
        } else {
          const matchName = p.category === selectedCatObj.name;
          const matchGroup = !selectedCatObj.groupId || !p.groupId || p.groupId === selectedCatObj.groupId;
          if (!matchName || !matchGroup) return false;
        }
      } else if (p.category !== categoryValue && p.categoryId !== categoryValue) {
        return false;
      }
    }

    return true;
  });
}

export function resolveGroupCategoryCascade(
  products: Product[],
  productGroups: ProductGroup[],
  categories: ProductCategory[],
  nextGroupId: string,
  currentCategoryId: string,
  selectedProductId?: string | null
): { nextCategoryId: string; clearSelectedProduct: boolean } {
  const normalizedGroupId = nextGroupId || 'all';
  let nextCategoryId = currentCategoryId || 'all';
  if (nextCategoryId !== 'all') {
    const stillValidCat = getScopedCategoriesForGroup(categories, normalizedGroupId, false).some(
      (c) => c.id === nextCategoryId || c.name === nextCategoryId
    );
    if (!stillValidCat) {
      nextCategoryId = 'all';
    }
  }
  if (!selectedProductId) {
    return { nextCategoryId, clearSelectedProduct: false };
  }
  const scopedProducts = filterProductsByGroupCategory(
    products,
    productGroups,
    categories,
    normalizedGroupId,
    nextCategoryId
  );
  const clearSelectedProduct = !scopedProducts.some((p) => p.id === selectedProductId);
  return { nextCategoryId, clearSelectedProduct };
}

interface LinkedGroupCategoryFilterProps {
  productGroups: ProductGroup[];
  categories: ProductCategory[];
  selectedGroupId: string;
  selectedCategoryId: string;
  onGroupChange?: (groupId: string) => void;
  onCategoryChange?: (categoryId: string) => void;
  onFilterChange?: (nextGroupId: string, nextCategoryId: string) => void;
  groupTriggerRef?: React.RefObject<HTMLButtonElement | null>;
  categoryTriggerRef?: React.RefObject<HTMLButtonElement | null>;
  autoAdvanceOnSelect?: boolean;
  onGroupAfterSelect?: () => void;
  onCategoryAfterSelect?: () => void;
  allLabel?: string;
  allowAll?: boolean;
  minSearchChars?: number;
  compact?: boolean;
  showLabels?: boolean;
  className?: string;
}

export const LinkedGroupCategoryFilter: React.FC<LinkedGroupCategoryFilterProps> = ({
  productGroups,
  categories,
  selectedGroupId,
  selectedCategoryId,
  onGroupChange,
  onCategoryChange,
  onFilterChange,
  groupTriggerRef: externalGroupRef,
  categoryTriggerRef: externalCategoryRef,
  autoAdvanceOnSelect = false,
  onGroupAfterSelect,
  onCategoryAfterSelect,
  allLabel,
  allowAll = true,
  minSearchChars = 0,
  compact = true,
  showLabels = false,
  className = '',
}) => {
  const { t } = usePreferences();
  const resolvedAllLabel = allLabel || t('الكل', 'All');
  const internalGroupRef = useRef<HTMLButtonElement | null>(null);
  const internalCategoryRef = useRef<HTMLButtonElement | null>(null);
  const groupRef = externalGroupRef || internalGroupRef;
  const categoryRef = externalCategoryRef || internalCategoryRef;

  const activeGroups = useMemo(
    () => productGroups.filter((g) => g.status !== 'suspended'),
    [productGroups]
  );

  const scopedCategories = useMemo(
    () => getScopedCategoriesForGroup(categories, selectedGroupId || 'all', false),
    [categories, selectedGroupId]
  );

  const groupOptions = useMemo<SearchableFilterOption[]>(
    () =>
      activeGroups.map((g) => ({
        value: g.id,
        label: g.name,
        searchText: `${g.name}`,
      })),
    [activeGroups]
  );

  const categoryOptions = useMemo<SearchableFilterOption[]>(
    () =>
      scopedCategories.map((c) => ({
        value: c.id,
        label:
          !selectedGroupId || selectedGroupId === 'all'
            ? c.groupName
              ? `${t(c.name)} (${c.groupName})`
              : t(c.name)
            : t(c.name),
        searchText: `${c.name} ${t(c.name)} ${c.groupName || ''}`,
      })),
    [scopedCategories, selectedGroupId, t]
  );

  const handleGroupSelect = (nextGroupId: string) => {
    let nextCategoryId = selectedCategoryId || 'all';
    if (nextCategoryId !== 'all') {
      const stillValid = getScopedCategoriesForGroup(categories, nextGroupId || 'all', false).some(
        (c) => c.id === nextCategoryId || c.name === nextCategoryId
      );
      if (!stillValid) {
        nextCategoryId = 'all';
      }
    }
    if (onFilterChange) {
      onFilterChange(nextGroupId, nextCategoryId);
      return;
    }
    onGroupChange?.(nextGroupId);
    if (nextCategoryId !== (selectedCategoryId || 'all')) {
      onCategoryChange?.(nextCategoryId);
    }
  };

  const handleCategorySelect = (nextCategoryId: string) => {
    if (onFilterChange) {
      onFilterChange(selectedGroupId || 'all', nextCategoryId);
    } else {
      onCategoryChange?.(nextCategoryId);
    }
  };

  const emptyResetValue = allowAll ? 'all' : '';

  const handleGroupSelectWithMode = (nextGroupId: string) => {
    let nextCategoryId = selectedCategoryId || emptyResetValue;
    if (nextCategoryId && nextCategoryId !== 'all') {
      const stillValid = getScopedCategoriesForGroup(categories, nextGroupId || 'all', false).some(
        (c) => c.id === nextCategoryId || c.name === nextCategoryId
      );
      if (!stillValid) {
        nextCategoryId = emptyResetValue;
      }
    }
    if (onFilterChange) {
      onFilterChange(nextGroupId, nextCategoryId);
      return;
    }
    onGroupChange?.(nextGroupId);
    if (nextCategoryId !== (selectedCategoryId || emptyResetValue)) {
      onCategoryChange?.(nextCategoryId);
    }
  };

  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      <SearchableFilterSelect
        label={showLabels ? t('المجموعة:', 'Group:') : undefined}
        inlinePrefix={!showLabels ? t('المجموعة', 'Group') : undefined}
        value={allowAll ? (selectedGroupId || 'all') : (selectedGroupId === 'all' ? '' : selectedGroupId)}
        onChange={allowAll ? handleGroupSelect : handleGroupSelectWithMode}
        options={groupOptions}
        includeAllOption={allowAll}
        allowClear={!allowAll}
        placeholder={t('اختيار المجموعة...', 'Select group...')}
        allOptionLabel={resolvedAllLabel}
        allOptionValue={emptyResetValue}
        minSearchChars={minSearchChars}
        searchPlaceholder={t('ابحث باسم المجموعة...', 'Search group...')}
        triggerRef={groupRef}
        onAfterSelect={() => {
          if (onGroupAfterSelect) {
            onGroupAfterSelect();
          } else if (autoAdvanceOnSelect) {
            categoryRef.current?.focus();
          }
        }}
        buttonClassName={compact ? 'h-8' : 'h-9'}
      />
      <SearchableFilterSelect
        label={showLabels ? t('التصنيف:', 'Category:') : undefined}
        inlinePrefix={!showLabels ? t('التصنيف', 'Category') : undefined}
        value={allowAll ? (selectedCategoryId || 'all') : (selectedCategoryId === 'all' ? '' : selectedCategoryId)}
        onChange={handleCategorySelect}
        options={categoryOptions}
        includeAllOption={allowAll}
        allowClear={!allowAll}
        placeholder={t('اختيار التصنيف...', 'Select category...')}
        allOptionLabel={resolvedAllLabel}
        allOptionValue={emptyResetValue}
        minSearchChars={minSearchChars}
        searchPlaceholder={t('ابحث باسم التصنيف...', 'Search category...')}
        triggerRef={categoryRef}
        onAfterSelect={() => {
          onCategoryAfterSelect?.();
        }}
        buttonClassName={compact ? 'h-8' : 'h-9'}
      />
    </div>
  );
};

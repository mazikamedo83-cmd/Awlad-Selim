import React, { useMemo } from 'react';
import { Product, ProductCategory, ProductGroup } from '../../types';
import { usePreferences } from '../../context/PreferencesContext';

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
    ? categories.find((c) => c.id === categoryValue || c.name === categoryValue)
    : undefined;

  return products.filter((p) => {
    if (hasGroup) {
      const matchDirectGroup = p.groupId === groupId || (selectedGroup && p.groupName === selectedGroup.name);
      const matchViaCat =
        (p.categoryId && groupCategoryIds.has(p.categoryId)) ||
        (p.category && groupCategoryNames.has(p.category));
      if (!matchDirectGroup && !matchViaCat) return false;
    }

    if (hasCat) {
      if (selectedCatObj) {
        const matchId = p.categoryId ? p.categoryId === selectedCatObj.id : false;
        const matchName = p.category === selectedCatObj.name;
        if (!matchId && !matchName) return false;
      } else if (p.category !== categoryValue && p.categoryId !== categoryValue) {
        return false;
      }
    }

    return true;
  });
}

interface LinkedGroupCategoryFilterProps {
  productGroups: ProductGroup[];
  categories: ProductCategory[];
  selectedGroupId: string;
  selectedCategoryId: string;
  onGroupChange: (groupId: string) => void;
  onCategoryChange: (categoryId: string) => void;
  allLabel?: string;
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
  allLabel,
  compact = true,
  showLabels = false,
  className = '',
}) => {
  const { t } = usePreferences();
  const resolvedAllLabel = allLabel || t('الكل', 'All');

  const activeGroups = useMemo(
    () => productGroups.filter((g) => g.status !== 'suspended'),
    [productGroups]
  );

  const scopedCategories = useMemo(
    () => getScopedCategoriesForGroup(categories, selectedGroupId || 'all', false),
    [categories, selectedGroupId]
  );

  const handleGroupSelect = (nextGroupId: string) => {
    onGroupChange(nextGroupId);
    if (selectedCategoryId && selectedCategoryId !== 'all') {
      const stillValid = getScopedCategoriesForGroup(categories, nextGroupId || 'all', false).some(
        (c) => c.id === selectedCategoryId || c.name === selectedCategoryId
      );
      if (!stillValid) {
        onCategoryChange('all');
      }
    }
  };

  return (
    <div className={`grid grid-cols-2 gap-2 ${className}`}>
      <div>
        {showLabels && (
          <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
            {t('المجموعة:', 'Group:')}
          </label>
        )}
        <select
          aria-label={t('تصفية حسب المجموعة', 'Filter by group')}
          value={selectedGroupId || 'all'}
          onChange={(e) => handleGroupSelect(e.target.value)}
          className={`w-full ${compact ? 'h-8' : 'h-9'} bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-bold text-slate-800 dark:text-[#EEF4FC]`}
        >
          <option value="all">
            {t('المجموعة:', 'Group:')} {resolvedAllLabel}
          </option>
          {activeGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        {showLabels && (
          <label className="block text-[11px] font-bold text-slate-700 mb-0.5">
            {t('التصنيف:', 'Category:')}
          </label>
        )}
        <select
          aria-label={t('تصفية حسب التصنيف', 'Filter by category')}
          value={selectedCategoryId || 'all'}
          onChange={(e) => onCategoryChange(e.target.value)}
          className={`w-full ${compact ? 'h-8' : 'h-9'} bg-white dark:bg-[#10203D] border border-slate-300 dark:border-[#2A436E] rounded-md px-2 text-xs font-bold text-slate-800 dark:text-[#EEF4FC]`}
        >
          <option value="all">
            {t('التصنيف:', 'Category:')} {resolvedAllLabel}
          </option>
          {scopedCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {t(c.name)}
              {!selectedGroupId || selectedGroupId === 'all'
                ? c.groupName
                  ? ` (${c.groupName})`
                  : ''
                : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from './AuthContext';
import { ShortcutActionId, ShortcutCategory, User, UserShortcutItem } from '../types';

export interface ShortcutDefinition {
  actionId: ShortcutActionId | string;
  label: string;
  category: ShortcutCategory;
  defaultCombo: string;
  permission?: keyof User['permissions'];
  allowInInputs?: boolean;
  navigateTo?: string;
}

export const SHORTCUT_CATALOG: ShortcutDefinition[] = [
  // التنقل والمبيعات والمشتريات
  { actionId: 'nav:dashboard', label: 'لوحة التحكم الرئيسية', category: 'التنقل', defaultCombo: 'Alt+1', navigateTo: 'dashboard' },
  { actionId: 'nav:new-sale', label: 'إنشاء فاتورة بيع جديدة', category: 'المبيعات والمشتريات', defaultCombo: 'F2', permission: 'canManageSales', allowInInputs: true, navigateTo: 'new-sale' },
  { actionId: 'nav:sales', label: 'سجل فواتير المبيعات', category: 'المبيعات والمشتريات', defaultCombo: 'Alt+2', permission: 'canManageSales', navigateTo: 'sales-invoices' },
  { actionId: 'nav:new-purchase', label: 'إنشاء فاتورة شراء جديدة', category: 'المبيعات والمشتريات', defaultCombo: 'F4', permission: 'canManagePurchases', allowInInputs: true, navigateTo: 'new-purchase' },
  { actionId: 'nav:purchases', label: 'سجل فواتير المشتريات', category: 'المبيعات والمشتريات', defaultCombo: 'Alt+3', permission: 'canManagePurchases', navigateTo: 'purchase-invoices' },
  { actionId: 'nav:returns', label: 'مرتجع المبيعات', category: 'المبيعات والمشتريات', defaultCombo: 'Alt+4', permission: 'canManageSales', navigateTo: 'sales-returns' },
  { actionId: 'nav:purchase-returns', label: 'مرتجع المشتريات', category: 'المبيعات والمشتريات', defaultCombo: '', permission: 'canManagePurchases', navigateTo: 'purchase-returns' },
  { actionId: 'nav:deleted-invoices', label: 'الفواتير المحذوفة والملغاة', category: 'المبيعات والمشتريات', defaultCombo: '', permission: 'canViewDeletedInvoices', navigateTo: 'deleted-invoices' },

  // أوامر الفواتير والطباعة
  { actionId: 'action:save_invoice', label: 'حفظ الفاتورة / السند الحالي', category: 'المبيعات والمشتريات', defaultCombo: 'Ctrl+S', allowInInputs: true },
  { actionId: 'action:print_document', label: 'طباعة الفاتورة / المستند الحالي', category: 'المبيعات والمشتريات', defaultCombo: 'Ctrl+P', permission: 'canPrint', allowInInputs: true },
  { actionId: 'action:focus_product_search', label: 'البحث السريع عن المنتجات داخل الفاتورة', category: 'المبيعات والمشتريات', defaultCombo: 'F3', allowInInputs: true },

  // المخزون والمنتجات
  { actionId: 'nav:products', label: 'المنتجات والأصناف الغذائية', category: 'المخزون', defaultCombo: 'F6', permission: 'canManageInventory', allowInInputs: true, navigateTo: 'products' },
  { actionId: 'action:add_product', label: 'إضافة منتج جديد', category: 'المخزون', defaultCombo: 'Alt+P', permission: 'canAdd', allowInInputs: true, navigateTo: 'products' },
  { actionId: 'nav:product-categories', label: 'تصنيفات السلع', category: 'المخزون', defaultCombo: '', permission: 'canManageInventory', navigateTo: 'product-categories' },
  { actionId: 'nav:units-settings', label: 'الوحدات ومعاملات التحويل', category: 'المخزون', defaultCombo: '', permission: 'canManageInventory', navigateTo: 'units-settings' },
  { actionId: 'nav:abu-selim-import', label: 'استيراد ملفات الأصناف', category: 'المخزون', defaultCombo: '', permission: 'canManageInventory', navigateTo: 'abu-selim-import' },
  { actionId: 'nav:warehouses', label: 'المستودعات والمخازن', category: 'المخزون', defaultCombo: 'Alt+5', permission: 'canManageWarehouses', navigateTo: 'warehouses' },
  { actionId: 'nav:stock-transfers', label: 'أوامر تحويل الأصناف المنظم', category: 'المخزون', defaultCombo: 'Alt+6', permission: 'canCreateStockTransfer', navigateTo: 'stock-transfers-orders' },
  { actionId: 'action:new_stock_transfer', label: 'إنشاء أمر تحويل أصناف جديد', category: 'المخزون', defaultCombo: 'Alt+T', permission: 'canCreateStockTransfer', allowInInputs: true, navigateTo: 'stock-transfers-orders' },
  { actionId: 'nav:stock-transfers-fast', label: 'تحويل سريع بين المستودعات', category: 'المخزون', defaultCombo: '', permission: 'canManageInventory', navigateTo: 'stock-transfers' },
  { actionId: 'nav:stock-count', label: 'جرد المخزن المعتمد', category: 'المخزون', defaultCombo: 'Alt+7', permission: 'canCreateStockCount', navigateTo: 'stock-counts' },
  { actionId: 'nav:stock-adjustments', label: 'تسوية سريعة للمخزون', category: 'المخزون', defaultCombo: '', permission: 'canManageInventory', navigateTo: 'stock-adjustments' },
  { actionId: 'nav:damaged-stock', label: 'بضاعة تالفة ومنتهية', category: 'المخزون', defaultCombo: '', permission: 'canManageInventory', navigateTo: 'damaged-stock' },
  { actionId: 'nav:stock-movements', label: 'سجل حركة الأصناف', category: 'المخزون', defaultCombo: '', permission: 'canManageInventory', navigateTo: 'stock-movements' },

  // العملاء والموردين والمالية
  { actionId: 'nav:customers', label: 'قائمة العملاء وكشوف الحساب', category: 'العملاء والمالية', defaultCombo: 'F7', permission: 'canManageSales', allowInInputs: true, navigateTo: 'customers' },
  { actionId: 'action:new_customer', label: 'إضافة عميل جديد', category: 'العملاء والمالية', defaultCombo: 'Alt+C', permission: 'canAdd', allowInInputs: true, navigateTo: 'customers' },
  { actionId: 'action:customer_collection', label: 'تسجيل تحصيل نقدية من عميل', category: 'العملاء والمالية', defaultCombo: 'Alt+R', permission: 'canManageAccounts', allowInInputs: true, navigateTo: 'customers' },
  { actionId: 'nav:suppliers', label: 'قائمة الموردين', category: 'العملاء والمالية', defaultCombo: 'Alt+8', permission: 'canManagePurchases', navigateTo: 'suppliers' },
  { actionId: 'action:add_supplier', label: 'إضافة مورد جديد', category: 'العملاء والمالية', defaultCombo: '', permission: 'canAdd', allowInInputs: true, navigateTo: 'suppliers' },
  { actionId: 'nav:cashboxes', label: 'الخزائن والبنوك والحركات النقدية', category: 'العملاء والمالية', defaultCombo: 'F8', permission: 'canManageCashboxes', allowInInputs: true, navigateTo: 'cashboxes' },
  { actionId: 'nav:cashbox-transfer', label: 'تحويل بين الخزائن', category: 'العملاء والمالية', defaultCombo: '', permission: 'canManageCashboxes', navigateTo: 'cashbox-transfer' },
  { actionId: 'action:cash_deposit', label: 'إيداع نقدي بالخزينة', category: 'العملاء والمالية', defaultCombo: 'Alt+D', permission: 'canManageCashboxes', allowInInputs: true },
  { actionId: 'action:cash_withdrawal', label: 'سحب نقدي من الخزينة', category: 'العملاء والمالية', defaultCombo: 'Alt+W', permission: 'canManageCashboxes', allowInInputs: true },
  { actionId: 'nav:expenses', label: 'المصروفات والإيرادات', category: 'العملاء والمالية', defaultCombo: 'Alt+9', permission: 'canManageCashboxes', navigateTo: 'expenses' },
  { actionId: 'action:add_expense', label: 'تسجيل مصروف أو إيراد جديد', category: 'العملاء والمالية', defaultCombo: '', permission: 'canManageCashboxes', allowInInputs: true, navigateTo: 'expenses' },
  { actionId: 'nav:personal-accounts', label: 'الحسابات الشخصية للملاك', category: 'العملاء والمالية', defaultCombo: '', permission: 'canViewPersonalAccounts', navigateTo: 'personal-accounts' },
  { actionId: 'nav:cheques', label: 'الشيكات (واردة / صادرة)', category: 'العملاء والمالية', defaultCombo: 'Alt+Q', permission: 'canManageAccounts', navigateTo: 'cheques' },
  { actionId: 'nav:installments', label: 'إدارة وجدولة الأقساط', category: 'العملاء والمالية', defaultCombo: '', permission: 'canManageAccounts', navigateTo: 'installments' },
  { actionId: 'nav:reps', label: 'قائمة المناديب', category: 'العملاء والمالية', defaultCombo: 'Alt+M', permission: 'canManageReps', navigateTo: 'reps' },
  { actionId: 'nav:rep-transfers', label: 'طلب تحويل بالنصف (المالي)', category: 'العملاء والمالية', defaultCombo: '', permission: 'canManageTransfers', navigateTo: 'rep-transfers' },
  { actionId: 'nav:rep-item-transfers', label: 'تحويل أصناف وعهدة (فاتورة)', category: 'العملاء والمالية', defaultCombo: '', permission: 'canManageTransfers', navigateTo: 'rep-item-transfers' },

  // عام والموظفين والإعدادات
  { actionId: 'nav:employees', label: 'شئون الموظفين', category: 'عام', defaultCombo: 'Alt+E', permission: 'canManageEmployees', navigateTo: 'employees' },
  { actionId: 'nav:reports', label: 'التقارير والتحليلات المالية', category: 'عام', defaultCombo: 'F9', permission: 'canViewReports', allowInInputs: true, navigateTo: 'reports' },
  { actionId: 'nav:users', label: 'إدارة المستخدمين والصلاحيات', category: 'عام', defaultCombo: '', permission: 'canManageUsers', navigateTo: 'users' },
  { actionId: 'nav:audit-log', label: 'سجل العمليات (Audit)', category: 'عام', defaultCombo: '', permission: 'canManageUsers', navigateTo: 'audit-log' },
  { actionId: 'nav:settings', label: 'إعدادات النظام العامة', category: 'عام', defaultCombo: 'Alt+S', permission: 'canManageSettings', navigateTo: 'system-settings' },
  { actionId: 'nav:shortcuts-settings', label: 'إعدادات اختصارات لوحة المفاتيح', category: 'عام', defaultCombo: 'Alt+K', allowInInputs: true, navigateTo: 'shortcuts-settings' },
  { actionId: 'nav:server-settings', label: 'إعدادات السيرفر والاتصال', category: 'عام', defaultCombo: '', permission: 'canManageSettings', navigateTo: 'server-settings' },
  { actionId: 'nav:backup', label: 'النسخ الاحتياطي والاستعادة', category: 'عام', defaultCombo: '', permission: 'canManageSettings', navigateTo: 'backup' },
  { actionId: 'nav:migration', label: 'سجل الترحيل و PostgreSQL', category: 'عام', defaultCombo: '', permission: 'canManageSettings', navigateTo: 'migration' },
];

const RESERVED_EDIT_COMBOS = new Set([
  'CTRL+C',
  'CTRL+V',
  'CTRL+X',
  'CTRL+A',
  'CTRL+Z',
  'CTRL+Y',
  'SHIFT+INSERT',
]);

function normalizePhysicalKey(e: KeyboardEvent): string {
  const code = e.code || '';
  if (/^Key([A-Z])$/.test(code)) {
    return code.replace('Key', '');
  }
  if (/^Digit([0-9])$/.test(code)) {
    return code.replace('Digit', '');
  }
  if (/^Numpad([0-9])$/.test(code)) {
    return code.replace('Numpad', '');
  }
  if (/^F([1-9]|1[0-2])$/.test(code)) {
    return code.toUpperCase();
  }
  const mapCode: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    NumpadEnter: 'Enter',
    Escape: 'Escape',
    Insert: 'Insert',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    Slash: '/',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
  };
  if (mapCode[code]) return mapCode[code];

  const key = (e.key || '').trim();
  if (/^F([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  if (key.length === 1 && /[a-z0-9]/i.test(key)) return key.toUpperCase();
  return '';
}

export function eventToKeyCombo(e: KeyboardEvent): string {
  if (['Control', 'Shift', 'Alt', 'Meta', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight'].includes(e.key) || ['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) {
    return '';
  }
  const key = normalizePhysicalKey(e);
  if (!key) return '';

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  // Standalone plain keys without modifiers are restricted to Function keys (F1..F12)
  const isFunctionKey = /^F([1-9]|1[0-2])$/.test(key);
  if (parts.length === 0 && !isFunctionKey) {
    return '';
  }
  parts.push(key);
  return parts.join('+');
}

export function normalizeComboString(combo: string): string {
  const parts = String(combo || '')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';
  let hasCtrl = false;
  let hasAlt = false;
  let hasShift = false;
  let mainKey = '';
  for (const raw of parts) {
    const u = raw.toUpperCase();
    if (u === 'CTRL' || u === 'CONTROL' || u === 'CMD') hasCtrl = true;
    else if (u === 'ALT') hasAlt = true;
    else if (u === 'SHIFT') hasShift = true;
    else mainKey = raw.length === 1 ? u : raw;
  }
  if (!mainKey) return '';
  const ordered: string[] = [];
  if (hasCtrl) ordered.push('Ctrl');
  if (hasAlt) ordered.push('Alt');
  if (hasShift) ordered.push('Shift');
  ordered.push(mainKey);
  return ordered.join('+');
}

export function isReservedSystemCombo(combo: string): boolean {
  const norm = normalizeComboString(combo).toUpperCase();
  return RESERVED_EDIT_COMBOS.has(norm);
}

interface ShortcutsContextType {
  catalog: ShortcutDefinition[];
  shortcuts: UserShortcutItem[];
  isSaving: boolean;
  saveError: string | null;
  getShortcutLabelForAction: (actionId: string) => string;
  findConflict: (keyCombo: string, excludeActionId?: string, list?: UserShortcutItem[]) => UserShortcutItem | null;
  saveShortcuts: (nextList: UserShortcutItem[]) => Promise<{ success: boolean; error?: string }>;
  resetToDefaults: () => Promise<{ success: boolean; error?: string }>;
  registerHandler: (actionId: string, handler: () => void) => () => void;
  consumePendingAction: (actionId: string) => boolean;
  triggerAction: (actionId: string) => void;
}

const ShortcutsContext = createContext<ShortcutsContextType | undefined>(undefined);

interface ShortcutsProviderProps {
  children: React.ReactNode;
  onNavigate: (pageId: string) => void;
}

export const ShortcutsProvider: React.FC<ShortcutsProviderProps> = ({ children, onNavigate }) => {
  const { currentUser, hasPermission, updateUserShortcuts } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handlersRef = useRef<Map<string, Set<() => void>>>(new Map());
  const pendingActionsRef = useRef<Set<string>>(new Set());

  const allowedCatalog = useMemo(() => {
    if (!currentUser) return [];
    return SHORTCUT_CATALOG.filter((def) => {
      if (!def.permission) return true;
      return hasPermission(def.permission);
    });
  }, [currentUser, hasPermission]);

  const buildDefaultShortcuts = useCallback((): UserShortcutItem[] => {
    return allowedCatalog.map((def) => ({
      id: `SC-${def.actionId}`,
      actionId: def.actionId,
      label: def.label,
      category: def.category,
      keyCombo: def.defaultCombo,
      enabled: Boolean(def.defaultCombo),
    }));
  }, [allowedCatalog]);

  const mergedShortcuts = useMemo((): UserShortcutItem[] => {
    if (!currentUser) return [];
    const saved = Array.isArray(currentUser.shortcuts) ? currentUser.shortcuts : [];
    if (saved.length === 0) {
      return buildDefaultShortcuts();
    }

    const savedByAction = new Map<string, UserShortcutItem>();
    for (const s of saved) {
      if (s?.actionId) savedByAction.set(s.actionId, s);
    }

    const usedCombos = new Set<string>();
    const list: UserShortcutItem[] = [];

    // First include catalog entries matching user's RBAC permissions
    for (const def of allowedCatalog) {
      const existing = savedByAction.get(def.actionId);
      if (existing) {
        const combo = normalizeComboString(existing.keyCombo);
        if (existing.enabled !== false && combo) usedCombos.add(combo.toUpperCase());
        list.push({
          id: existing.id || `SC-${def.actionId}`,
          actionId: def.actionId,
          label: existing.label || def.label,
          category: existing.category || def.category,
          keyCombo: combo,
          enabled: existing.enabled !== false,
        });
      } else {
        // New catalog action not yet in user's saved list: attach default only if combo is not already taken
        const defNorm = normalizeComboString(def.defaultCombo);
        const conflict = usedCombos.has(defNorm.toUpperCase());
        if (!conflict && defNorm) usedCombos.add(defNorm.toUpperCase());
        list.push({
          id: `SC-${def.actionId}`,
          actionId: def.actionId,
          label: def.label,
          category: def.category,
          keyCombo: conflict ? '' : defNorm,
          enabled: !conflict && Boolean(defNorm),
        });
      }
    }

    // Also include any custom user-added shortcut entries if any
    for (const s of saved) {
      if (!allowedCatalog.some((c) => c.actionId === s.actionId)) {
        // Skip actions that belong to a restricted catalog permission
        const restrictedDef = SHORTCUT_CATALOG.find((c) => c.actionId === s.actionId);
        if (restrictedDef) continue;
        list.push(s);
      }
    }

    return list;
  }, [currentUser, allowedCatalog, buildDefaultShortcuts]);

  const findConflict = useCallback(
    (keyCombo: string, excludeActionId?: string, listOverride?: UserShortcutItem[]): UserShortcutItem | null => {
      const norm = normalizeComboString(keyCombo).toUpperCase();
      if (!norm) return null;
      const source = listOverride || mergedShortcuts;
      return (
        source.find(
          (sc) =>
            sc.enabled !== false &&
            sc.actionId !== excludeActionId &&
            normalizeComboString(sc.keyCombo).toUpperCase() === norm
        ) || null
      );
    },
    [mergedShortcuts]
  );

  const saveShortcuts = useCallback(
    async (nextList: UserShortcutItem[]): Promise<{ success: boolean; error?: string }> => {
      setIsSaving(true);
      setSaveError(null);
      try {
        // Local conflict verification
        const seen = new Map<string, UserShortcutItem>();
        for (const item of nextList) {
          const combo = normalizeComboString(item.keyCombo);
          if (item.enabled !== false && combo) {
            if (isReservedSystemCombo(combo)) {
              const msg = `الاختصار (${combo}) محجوز لعمليات التحرير الأساسية بالنظام (نسخ/لصق/تحديد).`;
              setSaveError(msg);
              return { success: false, error: msg };
            }
            const upper = combo.toUpperCase();
            const existing = seen.get(upper);
            if (existing) {
              const msg = `الاختصار (${combo}) مستخدم بالفعل في الوظيفة: ${existing.label}`;
              setSaveError(msg);
              return { success: false, error: msg };
            }
            seen.set(upper, item);
          }
        }

        const cleanList = nextList.map((sc) => ({
          ...sc,
          keyCombo: normalizeComboString(sc.keyCombo),
        }));
        const res = await updateUserShortcuts(cleanList);
        if (!res.success) {
          setSaveError(res.error || 'تعذر حفظ الاختصارات');
          return { success: false, error: res.error };
        }
        return { success: true };
      } finally {
        setIsSaving(false);
      }
    },
    [updateUserShortcuts]
  );

  const resetToDefaults = useCallback(async () => {
    const defaults = buildDefaultShortcuts();
    return saveShortcuts(defaults);
  }, [buildDefaultShortcuts, saveShortcuts]);

  const registerHandler = useCallback((actionId: string, handler: () => void) => {
    const map = handlersRef.current;
    const set = map.get(actionId) || new Set<() => void>();
    set.add(handler);
    map.set(actionId, set);
    return () => {
      const currentSet = map.get(actionId);
      if (currentSet) {
        currentSet.delete(handler);
        if (currentSet.size === 0) map.delete(actionId);
      }
    };
  }, []);

  const consumePendingAction = useCallback((actionId: string): boolean => {
    if (pendingActionsRef.current.has(actionId)) {
      pendingActionsRef.current.delete(actionId);
      return true;
    }
    return false;
  }, []);

  const triggerAction = useCallback(
    (actionId: string) => {
      const def = SHORTCUT_CATALOG.find((d) => d.actionId === actionId);
      const handlers = handlersRef.current.get(actionId);

      if (actionId.startsWith('nav:')) {
        const targetPage = def?.navigateTo || actionId.slice(4);
        onNavigate(targetPage);
        return;
      }

      if (handlers && handlers.size > 0) {
        // Execute latest registered handler (e.g. open modal inside active page)
        const list = Array.from(handlers);
        const lastHandler = list[list.length - 1];
        lastHandler();
        return;
      }

      // If no live handler mounted yet and this action has a target page, navigate & queue pending action
      if (def?.navigateTo) {
        pendingActionsRef.current.add(actionId);
        onNavigate(def.navigateTo);
      }
    },
    [onNavigate]
  );

  useEffect(() => {
    if (!currentUser || currentUser.role === 'customer') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat) return;

      // Ignore global shortcut execution when the shortcut key-recorder modal is capturing keys
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-shortcut-recorder="true"]')) {
        return;
      }

      const combo = eventToKeyCombo(e);
      if (!combo) return;
      const upper = combo.toUpperCase();

      if (RESERVED_EDIT_COMBOS.has(upper)) {
        return;
      }

      const matched = mergedShortcuts.find(
        (sc) => sc.enabled !== false && normalizeComboString(sc.keyCombo).toUpperCase() === upper
      );
      if (!matched) return;

      const isInputFocused = Boolean(
        target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT' ||
            target.isContentEditable)
      );

      const def = SHORTCUT_CATALOG.find((d) => d.actionId === matched.actionId);
      const comboUpper = normalizeComboString(matched.keyCombo).toUpperCase();
      const isCtrlOrAlt = comboUpper.startsWith('CTRL+') || comboUpper.startsWith('ALT+');
      const isFnKey = /^(CTRL\+|ALT\+|SHIFT\+)*F([1-9]|1[0-2])$/.test(comboUpper);
      const safeInInputs = isCtrlOrAlt || isFnKey;

      if (isInputFocused && !(safeInInputs && (def?.allowInInputs || isCtrlOrAlt || isFnKey))) {
        return;
      }

      // Prevent browser save/print/find defaults when matched by our ERP shortcut
      e.preventDefault();
      e.stopPropagation();
      triggerAction(matched.actionId);
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [currentUser, mergedShortcuts, triggerAction]);

  const getShortcutLabelForAction = useCallback(
    (actionId: string): string => {
      const sc = mergedShortcuts.find((s) => s.actionId === actionId && s.enabled !== false && s.keyCombo);
      return sc ? sc.keyCombo : '';
    },
    [mergedShortcuts]
  );

  return (
    <ShortcutsContext.Provider
      value={{
        catalog: allowedCatalog,
        shortcuts: mergedShortcuts,
        isSaving,
        saveError,
        getShortcutLabelForAction,
        findConflict,
        saveShortcuts,
        resetToDefaults,
        registerHandler,
        consumePendingAction,
        triggerAction,
      }}
    >
      {children}
    </ShortcutsContext.Provider>
  );
};

export const useShortcuts = () => {
  const ctx = useContext(ShortcutsContext);
  if (!ctx) {
    throw new Error('useShortcuts must be used within a ShortcutsProvider');
  }
  return ctx;
};

import type { LanguagePreference } from '../types';
import { AR_TO_EN_MAP, translateDynamicArabic } from './dictionary';

export const LANGUAGE_PREF_KEY = 'awlad_selim_language_v1';

function readInitialLanguageSync(): LanguagePreference {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(LANGUAGE_PREF_KEY);
      if (saved === 'en' || saved === 'ar') return saved;
    }
  } catch {
    // ignore storage errors
  }
  return 'ar';
}

let activeLanguage: LanguagePreference = readInitialLanguageSync();

export function getActiveLanguage(): LanguagePreference {
  return activeLanguage;
}

export function getActiveDir(): 'rtl' | 'ltr' {
  return activeLanguage === 'en' ? 'ltr' : 'rtl';
}

export function getActiveLocale(): 'ar-EG' | 'en-US' {
  return activeLanguage === 'en' ? 'en-US' : 'ar-EG';
}

export function syncDocumentLanguageAndDir(lang: LanguagePreference): void {
  const dir: 'rtl' | 'ltr' = lang === 'en' ? 'ltr' : 'rtl';
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.dir = dir;
    root.lang = lang;
    root.setAttribute('data-lang', lang);
    if (document.body) {
      document.body.dir = dir;
      document.body.style.textAlign = dir === 'rtl' ? 'right' : 'left';
    }
    const desiredTitle =
      lang === 'en'
        ? 'AWLAD SELIM - Accounting & Business Management'
        : 'AWLAD SELIM - أولاد سليم للمحاسبة وإدارة الأعمال';
    if (document.title !== desiredTitle) {
      document.title = desiredTitle;
    }
  }
  if (typeof window !== 'undefined' && window.awladDesktop?.setLanguage) {
    window.awladDesktop.setLanguage(lang).catch(() => {});
  }
}

export function setActiveLanguageRuntime(lang: LanguagePreference): void {
  activeLanguage = lang;
  syncDocumentLanguageAndDir(lang);
}

/**
 * Bilingual translation helper usable both inside and outside React components.
 * In Arabic mode returns `arText`. In English mode returns `enText` if provided,
 * otherwise translates known Arabic phrases/statuses via `AR_TO_EN_MAP` and dynamic patterns,
 * while preserving user-entered data untouched.
 */
export function tr(arText: string, enText?: string): string {
  if (activeLanguage !== 'en') return arText;
  if (enText !== undefined) return enText;
  if (!arText) return arText;
  return AR_TO_EN_MAP[arText] ?? translateDynamicArabic(arText);
}

const SYSTEM_ENTITY_AR_TO_EN: Record<string, string> = {
  'عميل نقدي / عام': 'Cash / Walk-in Customer',
  'عميل نقدي / عرض سعر عام': 'Cash Customer / General Quote',
  'عميل نقدي': 'Cash Customer',
  'نقدي / عام': 'Cash / Walk-in',
  'نقدي عام': 'Walk-in Cash',
  'عميل عام': 'Walk-in Customer',
  'مورد عام': 'General Supplier',
  'مورد نقدي': 'Cash Supplier',
  'جهة صرف': 'Disbursement Party',
  'جهة تحصيل': 'Collection Party',
  'المستودع الرئيسي': 'Main Warehouse',
  'المخزن الرئيسي': 'Main Warehouse',
  'مخزون رئيسي': 'Main Warehouse',
  'مخزن رئيسي': 'Main Warehouse',
  'المستودع المحدد': 'Selected Warehouse',
  'الخزينة الرئيسية': 'Main Cashbox',
  'الفرع الرئيسي': 'Main Branch',
  'الفرع الرئيسي (الخزينة)': 'Main Branch (Cashbox)',
  'الفرع الرئيسي - أولاد سليم': 'Main Branch - AWLAD SELIM',
  'الإدارة العامة': 'General Administration',
  'الإدارة': 'Administration',
  'تحصيل محلي': 'Local Collection',
  'تحويل داخلي': 'Internal Transfer',
  'عام': 'General',
  'أصناف عامة': 'General Items',
  'رصيد الحساب': 'Account Balance',
};

/**
 * Translates ONLY known fixed system defaults (e.g., Main Warehouse, Cash Customer, Rep Van (...))
 * while strictly leaving all user-entered names (customers, suppliers, companies, persons, products) untouched.
 */
export function translateSystemEntityName(value?: string | null): string {
  const raw = String(value ?? '');
  if (!raw || activeLanguage !== 'en') return raw;
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  if (SYSTEM_ENTITY_AR_TO_EN[trimmed]) return SYSTEM_ENTITY_AR_TO_EN[trimmed];

  let m = trimmed.match(/^سيارة المندوب\s*\((.+)\)$/);
  if (m) return `Rep Van (${m[1]})`;

  m = trimmed.match(/^سيارة المندوب\s*[-–—]\s*(.+)$/);
  if (m) return `Rep Van - ${m[1]}`;

  m = trimmed.match(/^سيارة\s*\((.+)\)$/);
  if (m) return `Van (${m[1]})`;

  m = trimmed.match(/^سيارة\s*[-–—]\s*(.+)$/);
  if (m) return `Van - ${m[1]}`;

  m = trimmed.match(/^مخزن المندوب\s*\((.+)\)$/);
  if (m) return `Rep Warehouse (${m[1]})`;

  return raw;
}

export function formatLocaleDate(
  value: string | number | Date | undefined | null,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === undefined || value === null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(getActiveLocale(), options);
}

export function formatLocaleTime(
  value: string | number | Date | undefined | null,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === undefined || value === null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleTimeString(getActiveLocale(), options);
}

export function formatLocaleDateTime(
  value: string | number | Date | undefined | null,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value === undefined || value === null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(getActiveLocale(), options);
}

export function formatLocaleNumber(
  value: number | undefined | null,
  options?: Intl.NumberFormatOptions
): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString(getActiveLocale(), options);
}

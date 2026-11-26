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

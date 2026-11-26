import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LanguagePreference, ThemePreference } from '../types';
import { getPref, setPref, syncNativeStatusBarStyle } from '../services/native';
import {
  LANGUAGE_PREF_KEY,
  getActiveLocale,
  setActiveLanguageRuntime,
  syncDocumentLanguageAndDir,
  tr,
} from '../i18n/translator';

const THEME_PREF_KEY = 'awlad_selim_theme_pref_v1';
const DASHBOARD_HIDDEN_BALANCES_KEY = 'awlad_selim_hidden_balances_v1';
const DASHBOARD_BALANCES_RESET_EVENT = 'awlad_selim:reset_dashboard_balances';

export const MASKED_BALANCE_TEXT = '••••••';

export type DashboardBalanceSectionKey =
  | 'sales'
  | 'purchases'
  | 'cashboxes'
  | 'inventory'
  | 'customerDebts'
  | 'supplierDebts'
  | 'expenses'
  | 'income'
  | 'profits'
  | 'chart'
  | 'cashboxesTable'
  | 'invoicesTable';

export const ALL_DASHBOARD_BALANCE_KEYS: DashboardBalanceSectionKey[] = [
  'sales',
  'purchases',
  'cashboxes',
  'inventory',
  'customerDebts',
  'supplierDebts',
  'expenses',
  'income',
  'profits',
  'chart',
  'cashboxesTable',
  'invoicesTable',
];

function createInitialHiddenBalancesMap(fillValue = false): Record<DashboardBalanceSectionKey, boolean> {
  return ALL_DASHBOARD_BALANCE_KEYS.reduce((acc, key) => {
    acc[key] = fillValue;
    return acc;
  }, {} as Record<DashboardBalanceSectionKey, boolean>);
}

function readHiddenBalancesFromSessionStorage(): Record<DashboardBalanceSectionKey, boolean> {
  const base = createInitialHiddenBalancesMap(false);
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return base;
    const raw = window.sessionStorage.getItem(DASHBOARD_HIDDEN_BALANCES_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const key of ALL_DASHBOARD_BALANCE_KEYS) {
        base[key] = Boolean(parsed[key]);
      }
    }
  } catch {
    // ignore storage errors
  }
  return base;
}

function writeHiddenBalancesToSessionStorage(map: Record<DashboardBalanceSectionKey, boolean>): void {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return;
    window.sessionStorage.setItem(DASHBOARD_HIDDEN_BALANCES_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
}

export function resetDashboardBalancesSessionStorage(): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(DASHBOARD_HIDDEN_BALANCES_KEY);
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(DASHBOARD_BALANCES_RESET_EVENT));
    }
  } catch {
    // ignore
  }
}

interface PreferencesContextType {
  themePreference: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  setThemePreference: (pref: ThemePreference) => void;
  language: LanguagePreference;
  dir: 'rtl' | 'ltr';
  isRtl: boolean;
  isLtr: boolean;
  locale: 'ar-EG' | 'en-US';
  setLanguage: (lang: LanguagePreference) => void;
  t: (arText: string, enText?: string) => string;
  hiddenDashboardBalances: Record<DashboardBalanceSectionKey, boolean>;
  isDashboardBalanceHidden: (key: DashboardBalanceSectionKey) => boolean;
  toggleDashboardBalanceSection: (key: DashboardBalanceSectionKey) => void;
  areAllDashboardBalancesHidden: boolean;
  areAnyDashboardBalancesHidden: boolean;
  toggleAllDashboardBalances: () => void;
  resetDashboardBalancesVisibility: () => void;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

function getSystemDarkMatch(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export const PreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themePreference, setThemePrefState] = useState<ThemePreference>(() => {
    try {
      const saved = localStorage.getItem(THEME_PREF_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    } catch {
      // ignore
    }
    return 'light';
  });

  const [language, setLanguageState] = useState<LanguagePreference>(() => {
    try {
      const saved = localStorage.getItem(LANGUAGE_PREF_KEY);
      if (saved === 'ar' || saved === 'en') {
        setActiveLanguageRuntime(saved);
        return saved;
      }
    } catch {
      // ignore
    }
    setActiveLanguageRuntime('ar');
    return 'ar';
  });

  const [hiddenDashboardBalances, setHiddenDashboardBalances] = useState<Record<DashboardBalanceSectionKey, boolean>>(
    () => readHiddenBalancesFromSessionStorage()
  );

  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => getSystemDarkMatch());

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [savedTheme, savedLang] = await Promise.all([
        getPref(THEME_PREF_KEY),
        getPref(LANGUAGE_PREF_KEY),
      ]);
      if (!mounted) return;
      if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
        setThemePrefState(savedTheme);
      }
      if (savedLang === 'ar' || savedLang === 'en') {
        setActiveLanguageRuntime(savedLang);
        setLanguageState(savedLang);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResetEvent = () => {
      setHiddenDashboardBalances(createInitialHiddenBalancesMap(false));
    };
    window.addEventListener(DASHBOARD_BALANCES_RESET_EVENT, handleResetEvent);
    return () => window.removeEventListener(DASHBOARD_BALANCES_RESET_EVENT, handleResetEvent);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (ev: MediaQueryListEvent) => setSystemPrefersDark(ev.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    themePreference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themePreference;
  const dir: 'rtl' | 'ltr' = language === 'ar' ? 'rtl' : 'ltr';
  const locale: 'ar-EG' | 'en-US' = language === 'en' ? 'en-US' : 'ar-EG';

  useEffect(() => {
    setActiveLanguageRuntime(language);
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.classList.toggle('dark', resolvedTheme === 'dark');
      root.style.colorScheme = resolvedTheme;
      syncDocumentLanguageAndDir(language);
    }
    syncNativeStatusBarStyle('dark-header');
  }, [resolvedTheme, dir, language]);

  const setThemePreference = useCallback((pref: ThemePreference) => {
    setThemePrefState(pref);
    setPref(THEME_PREF_KEY, pref).catch(() => {});
  }, []);

  const setLanguage = useCallback((lang: LanguagePreference) => {
    setActiveLanguageRuntime(lang);
    setLanguageState(lang);
    setPref(LANGUAGE_PREF_KEY, lang).catch(() => {});
  }, []);

  const t = useCallback(
    (arText: string, enText?: string): string => {
      if (language !== 'en') return arText;
      if (enText !== undefined) return enText;
      return tr(arText);
    },
    [language]
  );

  const isDashboardBalanceHidden = useCallback(
    (key: DashboardBalanceSectionKey) => Boolean(hiddenDashboardBalances[key]),
    [hiddenDashboardBalances]
  );

  const toggleDashboardBalanceSection = useCallback((key: DashboardBalanceSectionKey) => {
    setHiddenDashboardBalances((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      writeHiddenBalancesToSessionStorage(next);
      return next;
    });
  }, []);

  const areAllDashboardBalancesHidden = useMemo(
    () => ALL_DASHBOARD_BALANCE_KEYS.every((key) => Boolean(hiddenDashboardBalances[key])),
    [hiddenDashboardBalances]
  );

  const areAnyDashboardBalancesHidden = useMemo(
    () => ALL_DASHBOARD_BALANCE_KEYS.some((key) => Boolean(hiddenDashboardBalances[key])),
    [hiddenDashboardBalances]
  );

  const toggleAllDashboardBalances = useCallback(() => {
    setHiddenDashboardBalances((prev) => {
      const allCurrentlyHidden = ALL_DASHBOARD_BALANCE_KEYS.every((key) => Boolean(prev[key]));
      const next = createInitialHiddenBalancesMap(!allCurrentlyHidden);
      writeHiddenBalancesToSessionStorage(next);
      return next;
    });
  }, []);

  const resetDashboardBalancesVisibility = useCallback(() => {
    const clean = createInitialHiddenBalancesMap(false);
    setHiddenDashboardBalances(clean);
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem(DASHBOARD_HIDDEN_BALANCES_KEY);
      }
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<PreferencesContextType>(
    () => ({
      themePreference,
      resolvedTheme,
      setThemePreference,
      language,
      dir,
      isRtl: dir === 'rtl',
      isLtr: dir === 'ltr',
      locale,
      setLanguage,
      t,
      hiddenDashboardBalances,
      isDashboardBalanceHidden,
      toggleDashboardBalanceSection,
      areAllDashboardBalancesHidden,
      areAnyDashboardBalancesHidden,
      toggleAllDashboardBalances,
      resetDashboardBalancesVisibility,
    }),
    [
      themePreference,
      resolvedTheme,
      setThemePreference,
      language,
      dir,
      locale,
      setLanguage,
      t,
      hiddenDashboardBalances,
      isDashboardBalanceHidden,
      toggleDashboardBalanceSection,
      areAllDashboardBalancesHidden,
      areAnyDashboardBalancesHidden,
      toggleAllDashboardBalances,
      resetDashboardBalancesVisibility,
    ]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
};

export function usePreferences(): PreferencesContextType {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    return {
      themePreference: 'light',
      resolvedTheme: 'light',
      setThemePreference: () => {},
      language: 'ar',
      dir: 'rtl',
      isRtl: true,
      isLtr: false,
      locale: getActiveLocale(),
      setLanguage: () => {},
      t: (arText: string, enText?: string) => tr(arText, enText),
      hiddenDashboardBalances: createInitialHiddenBalancesMap(false),
      isDashboardBalanceHidden: () => false,
      toggleDashboardBalanceSection: () => {},
      areAllDashboardBalancesHidden: false,
      areAnyDashboardBalancesHidden: false,
      toggleAllDashboardBalances: () => {},
      resetDashboardBalancesVisibility: () => {},
    };
  }
  return ctx;
}

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LanguagePreference, ThemePreference } from '../types';
import { getPref, setPref, syncNativeStatusBarStyle } from '../services/native';

const THEME_PREF_KEY = 'awlad_selim_theme_pref_v1';
const LANGUAGE_PREF_KEY = 'awlad_selim_language_v1';
export const DASHBOARD_MASKED_GROUPS_KEY = 'awlad_selim_dashboard_masked_groups_v1';

export type DashboardBalanceGroup =
  | 'sales'
  | 'purchases'
  | 'cashboxes'
  | 'inventory'
  | 'customerDebts'
  | 'supplierDebts'
  | 'expenses'
  | 'income'
  | 'chart'
  | 'cashboxTable'
  | 'recentInvoices';

export const ALL_DASHBOARD_BALANCE_GROUPS: DashboardBalanceGroup[] = [
  'sales',
  'purchases',
  'cashboxes',
  'inventory',
  'customerDebts',
  'supplierDebts',
  'expenses',
  'income',
  'chart',
  'cashboxTable',
  'recentInvoices',
];

function readMaskedGroupsFromSession(): DashboardBalanceGroup[] {
  try {
    if (typeof sessionStorage === 'undefined') return [];
    const raw = sessionStorage.getItem(DASHBOARD_MASKED_GROUPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((g): g is DashboardBalanceGroup =>
      ALL_DASHBOARD_BALANCE_GROUPS.includes(g as DashboardBalanceGroup)
    );
  } catch {
    return [];
  }
}

interface PreferencesContextType {
  themePreference: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  setThemePreference: (pref: ThemePreference) => void;
  language: LanguagePreference;
  dir: 'rtl' | 'ltr';
  setLanguage: (lang: LanguagePreference) => void;
  t: (arText: string, enText: string) => string;
  maskedDashboardGroups: DashboardBalanceGroup[];
  isDashboardGroupHidden: (group: DashboardBalanceGroup) => boolean;
  toggleDashboardGroupVisibility: (group: DashboardBalanceGroup) => void;
  areAllDashboardBalancesHidden: boolean;
  toggleAllDashboardBalances: () => void;
  resetDashboardBalanceMasks: () => void;
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
      if (saved === 'ar' || saved === 'en') return saved;
    } catch {
      // ignore
    }
    return 'ar';
  });

  const [maskedDashboardGroups, setMaskedDashboardGroups] = useState<DashboardBalanceGroup[]>(() =>
    readMaskedGroupsFromSession()
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
        setLanguageState(savedLang);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (ev: MediaQueryListEvent) => setSystemPrefersDark(ev.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePrivacyReset = () => {
      setMaskedDashboardGroups([]);
      try {
        sessionStorage.removeItem(DASHBOARD_MASKED_GROUPS_KEY);
      } catch {
        // ignore
      }
    };
    window.addEventListener('awlad:privacy-reset', handlePrivacyReset);
    return () => window.removeEventListener('awlad:privacy-reset', handlePrivacyReset);
  }, []);

  useEffect(() => {
    try {
      if (typeof sessionStorage === 'undefined') return;
      if (maskedDashboardGroups.length === 0) {
        sessionStorage.removeItem(DASHBOARD_MASKED_GROUPS_KEY);
      } else {
        sessionStorage.setItem(DASHBOARD_MASKED_GROUPS_KEY, JSON.stringify(maskedDashboardGroups));
      }
    } catch {
      // ignore
    }
  }, [maskedDashboardGroups]);

  const resolvedTheme: 'light' | 'dark' =
    themePreference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themePreference;
  const dir: 'rtl' | 'ltr' = language === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      root.classList.toggle('dark', resolvedTheme === 'dark');
      root.style.colorScheme = resolvedTheme;
      root.dir = dir;
      root.lang = language;
      if (document.body) {
        document.body.dir = dir;
        document.body.style.textAlign = dir === 'rtl' ? 'right' : 'left';
      }
    }
    syncNativeStatusBarStyle('dark-header');
  }, [resolvedTheme, dir, language]);

  const setThemePreference = (pref: ThemePreference) => {
    setThemePrefState(pref);
    setPref(THEME_PREF_KEY, pref).catch(() => {});
  };

  const setLanguage = (lang: LanguagePreference) => {
    setLanguageState(lang);
    setPref(LANGUAGE_PREF_KEY, lang).catch(() => {});
  };

  const isDashboardGroupHidden = useCallback(
    (group: DashboardBalanceGroup) => maskedDashboardGroups.includes(group),
    [maskedDashboardGroups]
  );

  const toggleDashboardGroupVisibility = useCallback((group: DashboardBalanceGroup) => {
    setMaskedDashboardGroups((prev) =>
      prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group]
    );
  }, []);

  const areAllDashboardBalancesHidden = useMemo(
    () => ALL_DASHBOARD_BALANCE_GROUPS.every((g) => maskedDashboardGroups.includes(g)),
    [maskedDashboardGroups]
  );

  const toggleAllDashboardBalances = useCallback(() => {
    setMaskedDashboardGroups((prev) =>
      ALL_DASHBOARD_BALANCE_GROUPS.every((g) => prev.includes(g))
        ? []
        : [...ALL_DASHBOARD_BALANCE_GROUPS]
    );
  }, []);

  const resetDashboardBalanceMasks = useCallback(() => {
    setMaskedDashboardGroups([]);
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(DASHBOARD_MASKED_GROUPS_KEY);
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
      setLanguage,
      t: (arText: string, enText: string) => (language === 'en' ? enText : arText),
      maskedDashboardGroups,
      isDashboardGroupHidden,
      toggleDashboardGroupVisibility,
      areAllDashboardBalancesHidden,
      toggleAllDashboardBalances,
      resetDashboardBalanceMasks,
    }),
    [
      themePreference,
      resolvedTheme,
      language,
      dir,
      maskedDashboardGroups,
      isDashboardGroupHidden,
      toggleDashboardGroupVisibility,
      areAllDashboardBalancesHidden,
      toggleAllDashboardBalances,
      resetDashboardBalanceMasks,
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
      setLanguage: () => {},
      t: (arText: string) => arText,
      maskedDashboardGroups: [],
      isDashboardGroupHidden: () => false,
      toggleDashboardGroupVisibility: () => {},
      areAllDashboardBalancesHidden: false,
      toggleAllDashboardBalances: () => {},
      resetDashboardBalanceMasks: () => {},
    };
  }
  return ctx;
}

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { LanguagePreference, ThemePreference } from '../types';
import { getPref, setPref, syncNativeStatusBarStyle } from '../services/native';

const THEME_PREF_KEY = 'awlad_selim_theme_pref_v1';
const LANGUAGE_PREF_KEY = 'awlad_selim_language_v1';

interface PreferencesContextType {
  themePreference: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  setThemePreference: (pref: ThemePreference) => void;
  language: LanguagePreference;
  dir: 'rtl' | 'ltr';
  setLanguage: (lang: LanguagePreference) => void;
  t: (arText: string, enText: string) => string;
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

  const value = useMemo<PreferencesContextType>(
    () => ({
      themePreference,
      resolvedTheme,
      setThemePreference,
      language,
      dir,
      setLanguage,
      t: (arText: string, enText: string) => (language === 'en' ? enText : arText),
    }),
    [themePreference, resolvedTheme, language, dir]
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
    };
  }
  return ctx;
}

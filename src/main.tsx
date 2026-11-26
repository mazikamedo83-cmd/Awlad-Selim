import { createRoot } from 'react-dom/client';
import '@fontsource/cairo/300.css';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/500.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import '@fontsource/cairo/900.css';
import App from './App.tsx';
import './index.css';
import { initDeepLinkCapture } from './services/native';
import { LANGUAGE_PREF_KEY, setActiveLanguageRuntime } from './i18n/translator';

if (typeof window !== 'undefined') {
  try {
    const savedLang = window.localStorage?.getItem(LANGUAGE_PREF_KEY);
    if (savedLang === 'en' || savedLang === 'ar') {
      setActiveLanguageRuntime(savedLang);
    }
  } catch {
    // ignore storage errors
  }
}

// Early Case A Google Maps Demo quota / auth failure capture BEFORE React renders
if (typeof window !== 'undefined') {
  const notifyMapsQuotaExceeded = (reason: string) => {
    (window as any).__AWLAD_GMP_QUOTA_EXCEEDED__ = reason;
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded', { detail: { reason } }));
  };

  const prevAuthFailure = (window as any).gm_authFailure;
  (window as any).gm_authFailure = () => {
    notifyMapsQuotaExceeded('gm_authFailure');
    if (typeof prevAuthFailure === 'function') {
      try {
        prevAuthFailure();
      } catch {
        // ignore
      }
    }
  };

  const origConsoleError = console.error.bind(console);
  console.error = (...args: any[]) => {
    try {
      const joined = args.map((a) => (typeof a === 'string' ? a : a?.message || '')).join(' ');
      if (/OverQuotaMapError|QuotaExceededError|BillingNotEnabledMapError|ApiTargetBlockedMapError/i.test(joined)) {
        notifyMapsQuotaExceeded(joined);
      }
    } catch {
      // ignore
    }
    origConsoleError(...args);
  };
}

initDeepLinkCapture();

createRoot(document.getElementById('root')!).render(<App />);

/**
 * Centralized Design System for AWLAD SELIM (Single Source of Truth)
 * Reference Visual Identity: Google AI Studio Preview
 *
 * All platforms (AI Studio Preview, Windows Electron, Android Capacitor, iOS Capacitor)
 * consume these tokens and shared component classes so visual updates propagate everywhere.
 */

export const DESIGN_TOKENS = {
  brand: {
    name: 'AWLAD SELIM',
    arabicName: 'أولاد سليم',
    subtitle: 'نظام المحاسبة وإدارة الأعمال المتكامل',
    logoPath: '/awlad-selim-logo.png',
  },
  colors: {
    primary: '#1e3a8a', // blue-900
    primaryDark: '#172554', // blue-950
    primaryAccent: '#2563eb', // blue-600
    royalIndigo: '#4338ca', // indigo-700
    softViolet: '#6366f1', // indigo-500
    softSky: '#eff6ff', // blue-50
    sidebarBg: '#f8fafc', // soft light gradient base
    sidebarHeaderBg: '#172554', // blue-950
    background: '#f8fafc', // slate-50
    appCanvas: '#f1f5f9', // slate-100
    surface: '#ffffff',
    surfaceMuted: '#f8fafc',
    border: '#e2e8f0', // slate-200
    textPrimary: '#1e293b', // slate-800
    textHeading: '#0f172a', // slate-900
    textMuted: '#64748b', // slate-500
    success: '#059669', // emerald-600
    warning: '#d97706', // amber-600
    danger: '#dc2626', // red-600
  },
  typography: {
    fontFamily: "'Cairo', 'Tajawal', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    direction: 'rtl' as const,
  },
  radii: {
    card: '1rem', // rounded-2xl
    modal: '1.5rem', // rounded-3xl
    control: '0.75rem', // rounded-xl
    pill: '9999px',
  },
} as const;

export const UI_CLASSES = {
  appShell: 'min-h-screen bg-slate-100 text-slate-800 font-sans antialiased pb-6',
  loadingScreen: 'flex items-center justify-center min-h-screen bg-slate-900 text-white font-sans',
  blueHeaderBar:
    'sticky top-0 z-30 bg-gradient-to-l from-blue-950 via-blue-900 to-indigo-950 text-white shadow-md pt-safe no-print',
  softGradientDrawer:
    'fixed inset-y-0 right-0 z-50 w-[86vw] max-w-[340px] sm:w-[340px] lg:w-[360px] bg-gradient-to-b from-white via-slate-50/95 to-indigo-50/55 text-slate-800 shadow-2xl border-l border-blue-100/90 flex flex-col pt-safe pb-safe transition-transform duration-300 ease-out no-print',
  drawerHeaderGradient:
    'flex items-center justify-between gap-3 px-4 py-3.5 border-b border-white/15 bg-gradient-to-l from-blue-950 via-blue-900 to-indigo-900 text-white shrink-0',
  drawerActiveItem:
    'bg-gradient-to-l from-blue-700 via-blue-600 to-indigo-600 text-white border-transparent shadow-md shadow-blue-900/15 font-black',
  card: 'bg-white rounded-2xl border border-slate-200 shadow-xs',
  cardMuted: 'bg-slate-50 rounded-2xl border border-slate-200',
  modalBackdrop: 'fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity',
  modalPanel:
    'relative w-full transform rounded-2xl bg-white shadow-2xl transition-all border border-slate-200 overflow-hidden',
  input:
    'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-hidden',
  btnPrimary:
    'inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white text-xs font-bold px-4 py-2 transition-colors cursor-pointer disabled:opacity-50',
  btnSecondary:
    'inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold px-4 py-2 transition-colors cursor-pointer disabled:opacity-50',
  btnDanger:
    'inline-flex items-center justify-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2 transition-colors cursor-pointer disabled:opacity-50',
  tableWrapper: 'w-full overflow-x-auto awlad-table-scroll',
} as const;

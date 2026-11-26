export interface AwladDesktopInfo {
  isElectron: boolean;
  platform: string;
  appVersion?: string;
  dataDir: string;
  backupsDir: string;
  envFilePath: string | null;
  port: number;
  lanUrls: Array<{ ip: string; url: string }>;
  databaseState?: {
    exists: boolean;
    valid: boolean;
    hasRealData: boolean;
    counts?: Record<string, number> | null;
  } | null;
}

export interface AwladDesktopBridge {
  isElectron: boolean;
  platform?: string;
  getDesktopInfo: () => Promise<AwladDesktopInfo>;
  openDataFolder: () => Promise<{ ok: boolean; error: string | null }>;
  openBackupsFolder: () => Promise<{ ok: boolean; error: string | null }>;
  copyText: (text: string) => Promise<{ ok: boolean }>;
  setLanguage?: (lang: 'ar' | 'en') => Promise<{ ok: boolean }>;
  offlineDb?: {
    get: (namespace: string, key: string) => Promise<{ ok: boolean; value: any }>;
    set: (namespace: string, key: string, value: any) => Promise<{ ok: boolean }>;
    remove: (namespace: string, key: string) => Promise<{ ok: boolean }>;
    writeMedia: (mediaKey: string, dataUrl: string) => Promise<{ ok: boolean }>;
    readMedia: (mediaKey: string) => Promise<{ ok: boolean; dataUrl: string | null }>;
  };
  secureVault?: {
    getItem: (key: string) => Promise<{ ok: boolean; value: string | null }>;
    setItem: (key: string, value: string) => Promise<{ ok: boolean }>;
    removeItem: (key: string) => Promise<{ ok: boolean }>;
  };
}

declare global {
  interface Window {
    awladDesktop?: AwladDesktopBridge;
  }
}

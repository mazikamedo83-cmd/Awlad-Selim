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
  getDesktopInfo: () => Promise<AwladDesktopInfo>;
  openDataFolder: () => Promise<{ ok: boolean; error: string | null }>;
  openBackupsFolder: () => Promise<{ ok: boolean; error: string | null }>;
  copyText: (text: string) => Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    awladDesktop?: AwladDesktopBridge;
  }
}

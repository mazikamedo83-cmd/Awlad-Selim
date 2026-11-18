export interface AwladDesktopInfo {
  isElectron: boolean;
  platform: string;
  appVersion?: string;
  dataDir: string;
  backupsDir: string;
  envFilePath: string | null;
  port: number;
  lanUrls: Array<{ ip: string; url: string }>;
  serverStatus?: 'online' | 'restarting' | 'error';
  databaseState?: {
    exists: boolean;
    valid: boolean;
    hasRealData: boolean;
    counts?: Record<string, number> | null;
  } | null;
}

export interface AwladTunnelRuntimeStatus {
  status: 'offline' | 'starting' | 'online' | 'error';
  provider: string;
  tunnelUrl: string;
  localPort: number;
  pid?: number | null;
  restartCount?: number;
  lastError?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
}

export interface AwladTunnelAutoStartConfig {
  enabled: boolean;
  mode: 'free_remote' | 'pro_remote';
  domainUrl?: string;
  hasToken?: boolean;
}

export interface AwladDesktopBridge {
  isElectron: boolean;
  getDesktopInfo: () => Promise<AwladDesktopInfo>;
  openDataFolder: () => Promise<{ ok: boolean; error: string | null }>;
  openBackupsFolder: () => Promise<{ ok: boolean; error: string | null }>;
  copyText: (text: string) => Promise<{ ok: boolean }>;
  getAutoStart?: () => Promise<{ ok: boolean; openAtLogin: boolean; supported: boolean }>;
  setAutoStart?: (enabled: boolean) => Promise<{ ok: boolean; openAtLogin: boolean; supported: boolean; error?: string }>;
  getTunnelStatus?: () => Promise<{ ok: boolean; status: AwladTunnelRuntimeStatus }>;
  startTunnel?: (opts: { mode?: 'free_remote' | 'pro_remote'; token?: string; domainUrl?: string; cloudflaredPath?: string }) => Promise<{ ok: boolean; error?: string | null; status: AwladTunnelRuntimeStatus }>;
  stopTunnel?: () => Promise<{ ok: boolean; status: AwladTunnelRuntimeStatus }>;
  getTunnelAutoStart?: () => Promise<{ ok: boolean; config: AwladTunnelAutoStartConfig }>;
  setTunnelAutoStart?: (opts: { enabled: boolean; mode?: 'free_remote' | 'pro_remote'; token?: string; domainUrl?: string }) => Promise<{ ok: boolean; error?: string; config: AwladTunnelAutoStartConfig }>;
}

declare global {
  interface Window {
    awladDesktop?: AwladDesktopBridge;
  }
}

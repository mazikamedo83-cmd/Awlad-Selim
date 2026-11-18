import React, { useState, useMemo, useEffect } from 'react';
import {
  Settings, Save, Download, Upload, Database, RefreshCw,
  Printer, Building2, ShieldCheck, Check, AlertCircle, Trash2, RotateCcw,
  Server, Wifi, WifiOff, Activity, Monitor, Smartphone, FileSpreadsheet,
  Eye, ArrowLeftRight, CheckCircle2, ShoppingCart, User, Layers,
  Barcode, FileText, Keyboard, Wrench, GitBranch, Plus, Search, Power,
  Globe, Cloud, ShieldAlert, Send, KeyRound, Loader2, Radio
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import {
  useShortcuts, SHORTCUT_CATALOG, eventToKeyCombo, isReservedSystemCombo, normalizeComboString
} from '../../../context/ShortcutsContext';
import {
  apiRequest,
  getConnectionModeLabel,
  resolveModeEndpointUrl,
  saveStoredConnectionProfiles,
  testEndpointViaServer,
  validateConnectionUrl,
} from '../../../services/api';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { Modal } from '../../common/Modal';
import { PairingAndDevicesPanel } from './PairingAndDevicesPanel';
import {
  ServerConnectionSettings, ProductImportCandidate,
  BranchSettingItem, PrinterSettingItem, ExtraSettingsConfig, UserShortcutItem, ShortcutCategory,
  ConnectionDiscoveryResponse, ConnectionMode, ConnectionProfilesConfig
} from '../../../types';

export type SettingsTabKey =
  | 'general'
  | 'server'
  | 'abu-selim'
  | 'backup'
  | 'migration'
  | 'branches'
  | 'barcode'
  | 'printers'
  | 'invoice-design'
  | 'mobile-config'
  | 'online-sync'
  | 'shortcuts'
  | 'services';

interface SettingsViewProps {
  initialTab?: SettingsTabKey;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ initialTab = 'general' }) => {
  const {
    settings, updateSettings, exportBackup, importBackup,
    serverSettings, updateServerSettings, testServerConnection, users,
    products, addProduct, deleteImportedProducts, warehouses, cashboxes, migrationLogs, runMigration, rollbackMigration,
  } = useData();
  const { hasPermission, currentUser } = useAuth();
  const {
    shortcuts: userShortcuts,
    catalog: userShortcutCatalog,
    isSaving: isSavingUserShortcuts,
    findConflict,
    saveShortcuts,
    resetToDefaults,
  } = useShortcuts();

  const canManageSettings = currentUser?.role === 'admin' || hasPermission('canManageSettings');
  const canManageInventory = currentUser?.role === 'admin' || hasPermission('canManageInventory');
  const resolvedInitialTab: SettingsTabKey =
    initialTab === 'shortcuts'
      ? 'shortcuts'
      : initialTab === 'abu-selim' && canManageInventory
      ? 'abu-selim'
      : canManageSettings
      ? initialTab
      : canManageInventory && initialTab === 'abu-selim'
      ? 'abu-selim'
      : 'shortcuts';

  const [activeTab, setActiveTab] = useState<SettingsTabKey>(resolvedInitialTab);

  useEffect(() => {
    setActiveTab(resolvedInitialTab);
  }, [resolvedInitialTab]);

  useEffect(() => {
    if (activeTab === 'migration' && !pgHealthInfo && !isTestingPg) {
      handleCheckPostgres();
    }
  }, [activeTab]);

  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<any>(null);
  const [pgHealthInfo, setPgHealthInfo] = useState<any>(null);
  const [isTestingPg, setIsTestingPg] = useState(false);
  const [desktopInfo, setDesktopInfo] = useState<any>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.awladDesktop?.isElectron) {
      window.awladDesktop.getDesktopInfo().then((info) => setDesktopInfo(info)).catch(() => {});
    }
  }, []);

  // General Settings Form
  const [formData, setFormData] = useState({ ...settings });
  const [isSaved, setIsSaved] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string>('تم حفظ الإعدادات بنجاح');
  const [importError, setImportError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);

  // Extra Control Panel Settings State
  const extra: ExtraSettingsConfig = settings.extraSettings || {};
  const [branches, setBranches] = useState<BranchSettingItem[]>(extra.branches || [
    { id: 'BR-MAIN', name: 'الفرع الرئيسي - أولاد سليم', code: 'MAIN', warehouseId: warehouses[0]?.id, cashboxId: cashboxes[0]?.id, isDefault: true, isActive: true },
  ]);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchCode, setNewBranchCode] = useState('');
  const [newBranchPhone, setNewBranchPhone] = useState('');
  const [newBranchAddress, setNewBranchAddress] = useState('');
  const [newBranchWarehouseId, setNewBranchWarehouseId] = useState(warehouses[0]?.id || '');
  const [newBranchCashboxId, setNewBranchCashboxId] = useState(cashboxes[0]?.id || '');

  const [barcodeConfig, setBarcodeConfig] = useState(extra.barcodeConfig || {
    labelWidthMm: 50,
    labelHeightMm: 25,
    showCompanyName: true,
    showProductCode: true,
    showPrice: true,
    prefix: 'AS-',
  });

  const [printers, setPrinters] = useState<PrinterSettingItem[]>(extra.printers || [
    { id: 'PRT-A4', name: 'طابعة الإدارة الرئيسية A4', role: 'a4', paperWidthMm: 210, ipOrPort: 'USB001', copies: 1, isDefault: true, isActive: true },
    { id: 'PRT-POS80', name: 'طابعة كاشير حرارية 80مم', role: 'cashier_thermal80', paperWidthMm: 80, ipOrPort: '192.168.1.201', copies: 1, isDefault: false, isActive: true },
  ]);
  const [newPrinterName, setNewPrinterName] = useState('');
  const [newPrinterRole, setNewPrinterRole] = useState<PrinterSettingItem['role']>('cashier_thermal80');
  const [newPrinterPort, setNewPrinterPort] = useState('USB001');
  const [newPrinterCopies, setNewPrinterCopies] = useState(1);

  const [invoiceTemplate, setInvoiceTemplate] = useState(extra.invoiceTemplate || {
    showLogo: true,
    showPreviousBalance: true,
    showRemainingBalance: true,
    showSignatureBoxes: true,
    footerText: settings.invoiceNotes || 'شكراً لتعاملكم مع مؤسسة أولاد سليم',
  });

  const [mobileConfig, setMobileConfig] = useState(extra.mobileConfig || {
    enableCustomerApp: true,
    enableRepApp: true,
    allowCustomerPriceView: true,
    requireOrderApproval: true,
  });

  const [onlineSyncConfig, setOnlineSyncConfig] = useState(extra.onlineSyncConfig || {
    autoSyncEnabled: true,
    syncIntervalSeconds: 30,
    cloudEndpointUrl: serverSettings?.apiBaseUrl || '',
  });

  const [servicesConfig, setServicesConfig] = useState(extra.servicesConfig || {
    enableBarcodeScanner: true,
    enableAutoBackup: true,
    enableWhatsAppAlerts: false,
    whatsappNumber: settings.phone1 || '',
  });

  useEffect(() => {
    setFormData({ ...settings });
    if (settings.extraSettings) {
      if (settings.extraSettings.branches) setBranches(settings.extraSettings.branches);
      if (settings.extraSettings.barcodeConfig) setBarcodeConfig(settings.extraSettings.barcodeConfig);
      if (settings.extraSettings.printers) setPrinters(settings.extraSettings.printers);
      if (settings.extraSettings.invoiceTemplate) setInvoiceTemplate(settings.extraSettings.invoiceTemplate);
      if (settings.extraSettings.mobileConfig) setMobileConfig(settings.extraSettings.mobileConfig);
      if (settings.extraSettings.onlineSyncConfig) setOnlineSyncConfig(settings.extraSettings.onlineSyncConfig);
      if (settings.extraSettings.servicesConfig) setServicesConfig(settings.extraSettings.servicesConfig);
    }
  }, [settings]);

  const showSavedBanner = (message: string) => {
    setSavedNotice(message);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const persistExtraSettings = async (patch: Partial<ExtraSettingsConfig>, message: string) => {
    await updateSettings({
      extraSettings: {
        ...(settings.extraSettings || {}),
        ...patch,
      },
    });
    showSavedBanner(message);
  };

  // Server Connection Settings Form
  const [serverForm, setServerForm] = useState<ServerConnectionSettings>({
    serverIp: serverSettings?.serverIp || '192.168.1.100',
    hostname: serverSettings?.hostname || 'awlad-selim-server',
    port: serverSettings?.port || 3000,
    apiBaseUrl: serverSettings?.apiBaseUrl || 'http://192.168.1.100:3000',
    connectionType: serverSettings?.connectionType || 'lan',
    serverStatus: serverSettings?.serverStatus || 'online',
    databaseStatus: serverSettings?.databaseStatus || 'connected',
    latencyMs: serverSettings?.latencyMs || 12,
    syncStatus: serverSettings?.syncStatus || 'connected',
    lastSuccessfulConnection: serverSettings?.lastSuccessfulConnection || new Date().toISOString(),
  });
  const [isTestingServer, setIsTestingServer] = useState(false);
  const [serverTestResult, setServerTestResult] = useState<{ success: boolean; latencyMs: number; message: string } | null>(null);
  const [isSavingServer, setIsSavingServer] = useState(false);

  const [connectionConfig, setConnectionConfig] = useState<ConnectionProfilesConfig>(() => ({
    activeMode: extra.connectionConfig?.activeMode || 'local_network',
    configVersion: Math.max(1, Number(extra.connectionConfig?.configVersion || 1)),
    localNetwork: {
      ip: extra.connectionConfig?.localNetwork?.ip || serverSettings?.serverIp || '192.168.1.100',
      port: Number(extra.connectionConfig?.localNetwork?.port || serverSettings?.port || 3000) || 3000,
      hostname: extra.connectionConfig?.localNetwork?.hostname || serverSettings?.hostname || 'awlad-selim-server',
    },
    freeRemote: {
      tunnelUrl: extra.connectionConfig?.freeRemote?.tunnelUrl || '',
      autoDetect: extra.connectionConfig?.freeRemote?.autoDetect !== false,
    },
    proRemote: {
      domainUrl: extra.connectionConfig?.proRemote?.domainUrl || '',
      provider: extra.connectionConfig?.proRemote?.provider || 'cloudflare_named_tunnel',
    },
    cloudVps: {
      vpsUrl: extra.connectionConfig?.cloudVps?.vpsUrl || '',
      notes: extra.connectionConfig?.cloudVps?.notes || '',
    },
    deploymentProfile: {
      hostingLocation: extra.connectionConfig?.deploymentProfile?.hostingLocation || (extra.connectionConfig?.activeMode === 'cloud_vps' ? 'cloud_vps' : 'laptop_windows'),
      domainType: extra.connectionConfig?.deploymentProfile?.domainType || 'none',
      planTier: extra.connectionConfig?.deploymentProfile?.planTier || 'free',
      subscriptionStatus: extra.connectionConfig?.deploymentProfile?.subscriptionStatus || 'none',
      subscriptionNote: extra.connectionConfig?.deploymentProfile?.subscriptionNote || '',
    },
    appDownloadUrls: {
      androidApkUrl: extra.connectionConfig?.appDownloadUrls?.androidApkUrl || '',
      iosStoreUrl: extra.connectionConfig?.appDownloadUrls?.iosStoreUrl || '',
      windowsUrl: extra.connectionConfig?.appDownloadUrls?.windowsUrl || '',
    },
    enforceHttpsForRemote: extra.connectionConfig?.enforceHttpsForRemote !== false,
    updatedAt: extra.connectionConfig?.updatedAt || null,
  }));
  const [discoverySnapshot, setDiscoverySnapshot] = useState<ConnectionDiscoveryResponse | null>(null);
  const [serverRuntimeInfo, setServerRuntimeInfo] = useState<any>(null);
  const [autoStartState, setAutoStartState] = useState<{ supported: boolean; openAtLogin: boolean; busy: boolean }>({
    supported: false,
    openAtLogin: false,
    busy: false,
  });
  const [tunnelAutoStart, setTunnelAutoStart] = useState<{ enabled: boolean; mode: 'free_remote' | 'pro_remote'; hasToken: boolean; busy: boolean }>({
    enabled: false,
    mode: 'free_remote',
    hasToken: false,
    busy: false,
  });
  const [tunnelRuntime, setTunnelRuntime] = useState<any>(null);
  const [namedTunnelTokenInput, setNamedTunnelTokenInput] = useState('');
  const [tunnelActionBusy, setTunnelActionBusy] = useState(false);
  const [tunnelActionError, setTunnelActionError] = useState<string | null>(null);
  const [vpsTestedUrl, setVpsTestedUrl] = useState<string>('');
  const [modeEndpointTests, setModeEndpointTests] = useState<Record<string, { testing: boolean; ok?: boolean; message?: string }>>({});
  const [broadcastingUpdate, setBroadcastingUpdate] = useState(false);

  const loadServerConnectionHub = async () => {
    try {
      const [discRes, infoRes] = await Promise.all([
        apiRequest<ConnectionDiscoveryResponse>('/api/connection/discovery', { skipAuth: true, timeoutMs: 5000 }).catch(() => null),
        apiRequest<any>('/api/admin/server-info', { timeoutMs: 5000 }).catch(() => null),
      ]);
      if (discRes?.ok) {
        setDiscoverySnapshot(discRes);
        if (discRes.tunnelStatus) setTunnelRuntime(discRes.tunnelStatus);
        if (discRes.profiles) {
          const remoteProfiles = discRes.profiles;
          setConnectionConfig((prev) => ({
            ...prev,
            activeMode: remoteProfiles.activeMode || prev.activeMode,
            configVersion: remoteProfiles.configVersion ?? prev.configVersion,
            enforceHttpsForRemote:
              remoteProfiles.enforceHttpsForRemote !== undefined
                ? remoteProfiles.enforceHttpsForRemote
                : prev.enforceHttpsForRemote,
            updatedAt: remoteProfiles.updatedAt ?? prev.updatedAt,
            localNetwork: {
              ip: remoteProfiles.localNetwork?.ip ?? prev.localNetwork?.ip ?? '192.168.1.100',
              port: remoteProfiles.localNetwork?.port ?? prev.localNetwork?.port ?? 3000,
              hostname: remoteProfiles.localNetwork?.hostname ?? prev.localNetwork?.hostname ?? 'awlad-selim-server',
            },
            freeRemote: {
              tunnelUrl: remoteProfiles.freeRemote?.tunnelUrl ?? prev.freeRemote?.tunnelUrl ?? '',
              autoDetect: remoteProfiles.freeRemote?.autoDetect ?? prev.freeRemote?.autoDetect ?? true,
            },
            proRemote: {
              domainUrl: remoteProfiles.proRemote?.domainUrl ?? prev.proRemote?.domainUrl ?? '',
              provider: remoteProfiles.proRemote?.provider ?? prev.proRemote?.provider ?? 'cloudflare_named_tunnel',
            },
            cloudVps: {
              vpsUrl: remoteProfiles.cloudVps?.vpsUrl ?? prev.cloudVps?.vpsUrl ?? '',
              notes: remoteProfiles.cloudVps?.notes ?? prev.cloudVps?.notes ?? '',
            },
            deploymentProfile: {
              hostingLocation: remoteProfiles.deploymentProfile?.hostingLocation ?? prev.deploymentProfile?.hostingLocation ?? 'laptop_windows',
              domainType: remoteProfiles.deploymentProfile?.domainType ?? prev.deploymentProfile?.domainType ?? 'none',
              planTier: remoteProfiles.deploymentProfile?.planTier ?? prev.deploymentProfile?.planTier ?? 'free',
              subscriptionStatus: remoteProfiles.deploymentProfile?.subscriptionStatus ?? prev.deploymentProfile?.subscriptionStatus ?? 'none',
              subscriptionNote: remoteProfiles.deploymentProfile?.subscriptionNote ?? prev.deploymentProfile?.subscriptionNote ?? '',
            },
            appDownloadUrls: {
              androidApkUrl: remoteProfiles.appDownloadUrls?.androidApkUrl ?? prev.appDownloadUrls?.androidApkUrl ?? '',
              iosStoreUrl: remoteProfiles.appDownloadUrls?.iosStoreUrl ?? prev.appDownloadUrls?.iosStoreUrl ?? '',
              windowsUrl: remoteProfiles.appDownloadUrls?.windowsUrl ?? prev.appDownloadUrls?.windowsUrl ?? '',
            },
          }));
        }
      }
      if (infoRes?.ok) {
        setServerRuntimeInfo(infoRes);
        if (infoRes.tunnelStatus) setTunnelRuntime(infoRes.tunnelStatus);
      }
    } catch {
      // ignore if offline
    }
    if (typeof window !== 'undefined' && window.awladDesktop?.isElectron) {
      try {
        const autoRes = await window.awladDesktop.getAutoStart?.();
        if (autoRes) {
          setAutoStartState({ supported: Boolean(autoRes.supported), openAtLogin: Boolean(autoRes.openAtLogin), busy: false });
        }
        const tunAutoRes = await window.awladDesktop.getTunnelAutoStart?.();
        if (tunAutoRes?.config) {
          setTunnelAutoStart({
            enabled: Boolean(tunAutoRes.config.enabled),
            mode: tunAutoRes.config.mode === 'pro_remote' ? 'pro_remote' : 'free_remote',
            hasToken: Boolean(tunAutoRes.config.hasToken),
            busy: false,
          });
        }
        const tunRes = await window.awladDesktop.getTunnelStatus?.();
        if (tunRes?.status) setTunnelRuntime(tunRes.status);
      } catch {
        // ignore IPC error
      }
    }
  };

  useEffect(() => {
    if (activeTab === 'server') {
      loadServerConnectionHub();
    }
  }, [activeTab]);

  // Abu Selim Products Import & Batch Delete State
  const [importCandidates, setImportCandidates] = useState<ProductImportCandidate[]>([]);
  const [importFileName, setImportFileName] = useState<string>('');
  const [isImportingToDb, setIsImportingToDb] = useState(false);
  const [importSuccessCount, setImportSuccessCount] = useState<number | null>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [showDeleteImportedConfirm, setShowDeleteImportedConfirm] = useState(false);
  const [isDeletingImported, setIsDeletingImported] = useState(false);
  const [deleteImportedReport, setDeleteImportedReport] = useState<{
    deletedCount: number;
    skippedCount: number;
    skippedItems?: Array<{ id: string; code: string; name: string }>;
  } | null>(null);

  // Per-User Keyboard Shortcuts Management State
  const [shortcutSearch, setShortcutSearch] = useState('');
  const [shortcutFeedback, setShortcutFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [recordingTarget, setRecordingTarget] = useState<{
    mode: 'edit' | 'add';
    actionId: string;
    label: string;
    category: ShortcutCategory | string;
    keyCombo: string;
  } | null>(null);
  const [recorderConflict, setRecorderConflict] = useState<string | null>(null);
  const [showResetShortcutsConfirm, setShowResetShortcutsConfirm] = useState(false);
  const [selectedDeleteBatchId, setSelectedDeleteBatchId] = useState<string>('all');

  const importedProductsList = useMemo(
    () => products.filter((p) => p.importedFromFile || Boolean(p.importBatchId)),
    [products]
  );

  const importBatches = useMemo(() => {
    const map = new Map<string, { batchId: string; fileName: string; count: number }>();
    importedProductsList.forEach((p) => {
      const batchId = p.importBatchId || 'UNBATCHED';
      const existing = map.get(batchId);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(batchId, {
          batchId,
          fileName: p.sourceFileName || (batchId === 'UNBATCHED' ? 'دفعة استيراد سابقة' : batchId),
          count: 1,
        });
      }
    });
    return Array.from(map.values());
  }, [importedProductsList]);

  // 1. General Settings Handlers
  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings(formData);
    showSavedBanner('تم حفظ إعدادات المنشأة والطباعة بنجاح');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const res = await importBackup(content);
      if (res.success) {
        setImportError(null);
        setRestoreSuccess('تمت استعادة قاعدة البيانات بنجاح! جاري تحديث البيانات...');
        setTimeout(() => window.location.reload(), 900);
      } else {
        setImportError(res.error || 'فشلت استعادة النسخة الاحتياطية');
      }
    };
    reader.readAsText(file);
  };

  // 2. Server Settings Handlers
  const handleTestConnection = async () => {
    setIsTestingServer(true);
    setServerTestResult(null);
    const res = await testServerConnection();
    setIsTestingServer(false);
    if (res.success) {
      setServerTestResult({
        success: true,
        latencyMs: res.latencyMs,
        message: `تم الاتصال بالسيرفر المحلي بنجاح (زمن الاستجابة: ${res.latencyMs} مللي ثانية)`,
      });
      setServerForm(prev => ({
        ...prev,
        serverStatus: 'online',
        databaseStatus: 'connected',
        latencyMs: res.latencyMs,
        syncStatus: 'connected',
        lastSuccessfulConnection: new Date().toISOString(),
      }));
    } else {
      setServerTestResult({
        success: false,
        latencyMs: res.latencyMs,
        message: res.error || 'تعذر الاتصال بعنوان السيرفر',
      });
    }
  };

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerTestResult(null);
    const activeMode = connectionConfig.activeMode || 'local_network';
    const endpointToCheck = resolveModeEndpointUrl(activeMode, connectionConfig);
    const urlCheck = validateConnectionUrl(
      activeMode,
      endpointToCheck,
      connectionConfig.enforceHttpsForRemote !== false
    );
    if (!urlCheck.valid || !urlCheck.normalizedUrl) {
      setServerTestResult({
        success: false,
        latencyMs: 0,
        message: urlCheck.error || `عنوان وضع الاتصال النشط (${getConnectionModeLabel(activeMode)}) غير صالح.`,
      });
      return;
    }

    // Cloud VPS requires a successful reachability test BEFORE saving/applying
    if (activeMode === 'cloud_vps' && vpsTestedUrl !== urlCheck.normalizedUrl) {
      setIsTestingServer(true);
      try {
        const probe = await testEndpointViaServer('cloud_vps', urlCheck.normalizedUrl, connectionConfig.enforceHttpsForRemote !== false);
        setVpsTestedUrl(probe.url);
        setModeEndpointTests((prev) => ({
          ...prev,
          cloud_vps: {
            testing: false,
            ok: true,
            message: `تم التحقق من سيرفر VPS بنجاح (${probe.latencyMs}ms • ${probe.httpsVerified ? 'HTTPS' : 'HTTP'})`,
          },
        }));
      } catch (err: any) {
        setIsTestingServer(false);
        setServerTestResult({
          success: false,
          latencyMs: 0,
          message: err?.message || 'فشل اختبار الاتصال بسيرفر Cloud VPS. لم يتم حفظ التبديل لحماية التطبيقات المرتبطة.',
        });
        return;
      }
      setIsTestingServer(false);
    }

    setIsSavingServer(true);
    try {
      const nextCfg: ConnectionProfilesConfig = {
        ...connectionConfig,
        configVersion: Math.max(1, Number(connectionConfig.configVersion || 1)) + 1,
        updatedAt: new Date().toISOString(),
      };
      await updateSettings({
        extraSettings: {
          ...(settings.extraSettings || {}),
          connectionConfig: nextCfg,
        },
      });
      const localIp = nextCfg.localNetwork?.ip || serverForm.serverIp || '192.168.1.100';
      const localPort = Number(nextCfg.localNetwork?.port || serverForm.port || 3000) || 3000;
      const localHostname = nextCfg.localNetwork?.hostname || serverForm.hostname || 'awlad-selim-server';
      await updateServerSettings({
        ...serverForm,
        serverIp: localIp,
        port: localPort,
        hostname: localHostname,
        connectionType: activeMode === 'local_network' ? 'lan' : activeMode === 'pro_remote' || activeMode === 'free_remote' ? 'reverse_proxy' : 'vpn',
        apiBaseUrl: urlCheck.normalizedUrl,
      });
      saveStoredConnectionProfiles(nextCfg);
      setConnectionConfig(nextCfg);
      showSavedBanner(`تم حفظ وضع الاتصال (${getConnectionModeLabel(activeMode)}) وتحديث ملف تعريف السيرفر بنجاح.`);
      await loadServerConnectionHub();
    } catch (err: any) {
      setServerTestResult({
        success: false,
        latencyMs: 0,
        message: err?.message || 'تعذر حفظ إعدادات الاتصال',
      });
    } finally {
      setIsSavingServer(false);
    }
  };

  const handleTestModeEndpoint = async (mode: ConnectionMode) => {
    const rawUrl = resolveModeEndpointUrl(mode, connectionConfig);
    const localCheck = validateConnectionUrl(mode, rawUrl, connectionConfig.enforceHttpsForRemote !== false);
    if (!localCheck.valid || !localCheck.normalizedUrl) {
      setModeEndpointTests((prev) => ({
        ...prev,
        [mode]: { testing: false, ok: false, message: localCheck.error || 'الرابط غير صالح' },
      }));
      return;
    }
    setModeEndpointTests((prev) => ({ ...prev, [mode]: { testing: true } }));
    try {
      const probe = await testEndpointViaServer(mode, localCheck.normalizedUrl, connectionConfig.enforceHttpsForRemote !== false);
      if (mode === 'cloud_vps') setVpsTestedUrl(probe.url);
      setModeEndpointTests((prev) => ({
        ...prev,
        [mode]: {
          testing: false,
          ok: true,
          message: `استجابة ناجحة من ${probe.companyName || 'السيرفر'} (${probe.latencyMs}ms${probe.httpsVerified ? ' • HTTPS موثق' : ''})`,
        },
      }));
    } catch (err: any) {
      setModeEndpointTests((prev) => ({
        ...prev,
        [mode]: { testing: false, ok: false, message: err?.message || 'تعذر الوصول إلى هذا المسار' },
      }));
    }
  };

  const handleToggleAutoStart = async (enabled: boolean) => {
    if (!window.awladDesktop?.setAutoStart) return;
    setAutoStartState((prev) => ({ ...prev, busy: true }));
    try {
      const res = await window.awladDesktop.setAutoStart(enabled);
      setAutoStartState({ supported: Boolean(res.supported), openAtLogin: Boolean(res.openAtLogin), busy: false });
      showSavedBanner(res.openAtLogin ? 'تم تفعيل التشغيل التلقائي مع بدء Windows' : 'تم إيقاف التشغيل التلقائي مع Windows');
    } catch {
      setAutoStartState((prev) => ({ ...prev, busy: false }));
    }
  };

  const handleStartDesktopTunnel = async (mode: 'free_remote' | 'pro_remote') => {
    if (!window.awladDesktop?.startTunnel) return;
    setTunnelActionError(null);
    setTunnelActionBusy(true);
    try {
      const res = await window.awladDesktop.startTunnel({
        mode,
        token: mode === 'pro_remote' ? namedTunnelTokenInput.trim() : undefined,
        domainUrl: mode === 'pro_remote' ? connectionConfig.proRemote?.domainUrl : undefined,
      });
      if (res.status) setTunnelRuntime(res.status);
      if (!res.ok) {
        setTunnelActionError(res.error || 'تعذر تشغيل النفق الخارجي');
      } else {
        showSavedBanner(mode === 'free_remote' ? 'تم تشغيل Cloudflare Quick Tunnel — جاري التقاط رابط HTTPS...' : 'تم تشغيل Cloudflare Named Tunnel');
        setTimeout(() => loadServerConnectionHub(), 2000);
        setTimeout(() => loadServerConnectionHub(), 4500);
      }
    } catch (err: any) {
      setTunnelActionError(err?.message || 'تعذر تشغيل النفق');
    } finally {
      setTunnelActionBusy(false);
    }
  };

  const handleToggleTunnelAutoStart = async (enabled: boolean) => {
    if (!window.awladDesktop?.setTunnelAutoStart) return;
    const targetMode: 'free_remote' | 'pro_remote' =
      connectionConfig.activeMode === 'pro_remote' ? 'pro_remote' : 'free_remote';
    if (enabled && targetMode === 'pro_remote' && !namedTunnelTokenInput.trim() && !tunnelAutoStart.hasToken) {
      setTunnelActionError('أدخل Named Tunnel Token أولاً قبل تفعيل التشغيل التلقائي للوضع الاحترافي.');
      return;
    }
    setTunnelActionError(null);
    setTunnelAutoStart((prev) => ({ ...prev, busy: true }));
    try {
      const res = await window.awladDesktop.setTunnelAutoStart({
        enabled,
        mode: targetMode,
        token: targetMode === 'pro_remote' && namedTunnelTokenInput.trim() ? namedTunnelTokenInput.trim() : undefined,
        domainUrl: targetMode === 'pro_remote' ? connectionConfig.proRemote?.domainUrl : undefined,
      });
      if (res?.config) {
        setTunnelAutoStart({
          enabled: Boolean(res.config.enabled),
          mode: res.config.mode === 'pro_remote' ? 'pro_remote' : 'free_remote',
          hasToken: Boolean(res.config.hasToken),
          busy: false,
        });
      }
      showSavedBanner(
        res?.config?.enabled
          ? 'تم تفعيل تشغيل نفق Cloudflare تلقائياً عند فتح البرنامج على اللابتوب'
          : 'تم إيقاف التشغيل التلقائي للنفق عند فتح البرنامج'
      );
    } catch (err: any) {
      setTunnelActionError(err?.message || 'تعذر تحديث إعداد التشغيل التلقائي للنفق');
      setTunnelAutoStart((prev) => ({ ...prev, busy: false }));
    }
  };

  const handleStopDesktopTunnel = async () => {
    if (!window.awladDesktop?.stopTunnel) return;
    setTunnelActionError(null);
    setTunnelActionBusy(true);
    try {
      const res = await window.awladDesktop.stopTunnel();
      if (res.status) setTunnelRuntime(res.status);
      showSavedBanner('تم إيقاف النفق الخارجي بأمان');
      await loadServerConnectionHub();
    } finally {
      setTunnelActionBusy(false);
    }
  };

  const handleBroadcastUpdate = async () => {
    setBroadcastingUpdate(true);
    try {
      const res = await apiRequest<{ ok: boolean; connectionConfig: ConnectionProfilesConfig }>('/api/admin/connection/broadcast-update', {
        method: 'POST',
      });
      if (res.connectionConfig) {
        setConnectionConfig(res.connectionConfig);
        saveStoredConnectionProfiles(res.connectionConfig);
      }
      showSavedBanner(`تم تعميم تحديث إعدادات الاتصال للأجهزة المرتبطة (الإصدار v${res.connectionConfig?.configVersion || ''})`);
      await loadServerConnectionHub();
    } catch (err: any) {
      setServerTestResult({ success: false, latencyMs: 0, message: err?.message || 'تعذر تعميم التحديث' });
    } finally {
      setBroadcastingUpdate(false);
    }
  };

  // 3. Abu Selim Files Importer Handler
  const handleParseAbuSelimFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportSuccessCount(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const rawText = event.target?.result as string;
      if (!rawText) return;

      const existingCodes = new Set(products.map(p => p.code.toLowerCase().trim()));
      const existingNames = new Set(products.map(p => p.name.toLowerCase().trim()));
      const parsedCandidates: ProductImportCandidate[] = [];
      const seenFileCodes = new Set<string>();
      const seenFileNames = new Set<string>();

      // Supports the supplied MySQL INSERT catalog as well as simple CSV/TXT lists.
      const sqlRows = [...rawText.matchAll(/INSERT\s+INTO\s+`?products`?\s*\([^)]*\)\s*VALUES\s*\(\s*'((?:\\'|[^'])*)'\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*'([^']*)'\s*,\s*'((?:\\'|[^'])*)'\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gim)];

      if (sqlRows.length > 0) {
        sqlRows.forEach((match, index) => {
          const [, rawName, price, oldPrice, imageFile, rawDescription, stock, , categoryId] = match;
          const name = rawName.replace(/\\'/g, "'");
          const description = rawDescription.replace(/\\'/g, "'");
          const code = `AS-${String(index + 1).padStart(4, '0')}`;
          const category = categoryId === '10' ? 'مشروبات وعصائر' : 'شيبسيات ومقرمشات';
          const isDuplicateCode = existingCodes.has(code.toLowerCase()) || seenFileCodes.has(code.toLowerCase());
          const isDuplicateName = existingNames.has(name.toLowerCase()) || seenFileNames.has(name.toLowerCase());
          seenFileCodes.add(code.toLowerCase());
          seenFileNames.add(name.toLowerCase());
          parsedCandidates.push({
            id: `IMP-${index + 1}`, code, name, category, baseUnit: 'كرتونة',
            sourceFile: file.name, isDuplicateCode, isDuplicateName,
            isValid: name.trim().length > 1 && !isDuplicateCode, status: 'pending',
            sellingPrice: Number(price), oldPrice: Number(oldPrice),
            image: `/product-images/${imageFile}`, description: `${description} | رصيد المصدر: ${stock}`,
          });
        });
      } else {
        const lines = rawText.split(/\r?\n/).filter(line => line.trim().length > 0);
        lines.forEach((line, index) => {
          const parts = line.split(/[,\t;|]/).map(part => part.trim());
          let code = '';
          let name = '';
          let category = 'مواد غذائية';
          let baseUnit = 'قطعة';
          if (parts.length >= 2 && /^[a-zA-Z0-9_\-\.]+$/.test(parts[0])) {
            [code, name] = parts;
            if (parts[2]) category = parts[2];
            if (parts[3]) baseUnit = parts[3];
          } else {
            code = `AS-${file.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase()}-${index + 1001}`;
            name = parts[0];
          }
          if (!name || name.length < 2) return;
          if (file.name.includes('شيبس') || file.name.includes('مقرمشات')) category = 'شيبسيات ومقرمشات';
          else if (file.name.includes('مشروب') || file.name.includes('عصير')) category = 'مشروبات وعصائر';
          const isDuplicateCode = existingCodes.has(code.toLowerCase()) || seenFileCodes.has(code.toLowerCase());
          const isDuplicateName = existingNames.has(name.toLowerCase()) || seenFileNames.has(name.toLowerCase());
          seenFileCodes.add(code.toLowerCase());
          seenFileNames.add(name.toLowerCase());
          parsedCandidates.push({
            id: `IMP-${index + 1}`, code, name, category, baseUnit,
            sourceFile: file.name, isDuplicateCode, isDuplicateName,
            isValid: !isDuplicateCode, status: 'pending',
          });
        });
      }
      setImportCandidates(parsedCandidates);
    };
    reader.readAsText(file);
  };

  const handleExcludeCandidate = (candidateId: string) => {
    setImportCandidates(prev => prev.filter(c => c.id !== candidateId));
  };

  const handleEditCandidate = (candidateId: string, updatedName: string, updatedCategory: string) => {
    setImportCandidates(prev => prev.map(c => {
      if (c.id === candidateId) {
        return {
          ...c,
          name: updatedName,
          category: updatedCategory,
          isValid: updatedName.trim().length > 0 && !c.isDuplicateCode,
        };
      }
      return c;
    }));
  };

  const handleCancelImport = () => {
    setImportCandidates([]);
    setImportFileName('');
    setImportSuccessCount(null);
  };

  const handleRequestImportConfirm = () => {
    const existingCodes = new Set(products.map(p => p.code.toLowerCase().trim()));
    const validOnes = importCandidates.filter(c => c.isValid && !existingCodes.has(c.code.toLowerCase().trim()));
    if (validOnes.length === 0) {
      setImportError('لا توجد أصناف جديدة صالحة للاستيراد (قد تكون مسجلة مسبقاً)');
      return;
    }
    setImportError(null);
    setShowImportConfirm(true);
  };

  const handleExecuteImport = async () => {
    const existingCodes = new Set(products.map(p => p.code.toLowerCase().trim()));
    const validOnes = importCandidates.filter(c => c.isValid && !existingCodes.has(c.code.toLowerCase().trim()));
    if (validOnes.length === 0) {
      setShowImportConfirm(false);
      return;
    }

    setShowImportConfirm(false);
    setIsImportingToDb(true);
    setImportError(null);
    let count = 0;
    let skippedDup = 0;
    const defaultWarehouseId = warehouses[0]?.id || 'WH-01';
    const importBatchId = `IMP-${Date.now()}`;

    for (const item of validOnes) {
      try {
        await addProduct({
          code: item.code,
          barcode: item.code,
          name: item.name,
          category: item.category,
          baseUnit: item.baseUnit,
          units: [],
          purchasePrice: 0,
          sellingPrice: 0,
          minStockLevel: 20,
          stockPerWarehouse: { [defaultWarehouseId]: 0 },
          status: 'active',
          image: item.image,
          importBatchId,
          importedFromFile: true,
          sourceFileName: item.sourceFile || importFileName,
          notes: [item.description, item.oldPrice != null ? `السعر السابق بالكتالوج: ${item.oldPrice}` : '', `تم الاستيراد من (${item.sourceFile}).`].filter(Boolean).join(' | '),
        });
        count++;
      } catch {
        skippedDup++;
      }
    }

    setIsImportingToDb(false);
    setImportSuccessCount(count);
    if (skippedDup > 0) {
      setImportError(`تم تخطي (${skippedDup}) صنف لوجود تعارض في الكود أو الباركود.`);
    }
    setImportCandidates([]);
  };

  const handleExecuteDeleteImported = async () => {
    setIsDeletingImported(true);
    setImportError(null);
    setDeleteImportedReport(null);
    const payload =
      selectedDeleteBatchId === 'all' || selectedDeleteBatchId === 'UNBATCHED'
        ? { deleteAllImported: true }
        : { batchId: selectedDeleteBatchId };
    const res = await deleteImportedProducts(payload);
    setIsDeletingImported(false);
    setShowDeleteImportedConfirm(false);
    if (!res.success) {
      setImportError(res.error || 'تعذر مسح الأصناف المستوردة');
    } else {
      setDeleteImportedReport({
        deletedCount: res.deletedCount || 0,
        skippedCount: res.skippedCount || 0,
        skippedItems: res.skippedItems || [],
      });
      if (selectedDeleteBatchId !== 'all' && (res.skippedCount || 0) === 0) {
        setSelectedDeleteBatchId('all');
      }
    }
  };

  const handleCheckPostgres = async () => {
    setIsTestingPg(true);
    try {
      const payload = await apiRequest<{ ok: boolean; health: any }>('/api/admin/db/health');
      setPgHealthInfo(payload.health);
    } catch (err: any) {
      setPgHealthInfo({ status: 'offline', message: err?.message || 'تعذر الاتصال بخدمة السيرفر' });
    } finally {
      setIsTestingPg(false);
    }
  };

  const handleRollbackMigration = async () => {
    setIsMigrating(true);
    try {
      const latestId = migrationLogs?.[0]?.id;
      const res = await rollbackMigration(latestId);
      if (res.success) {
        setMigrationResult({ success: true, log: { id: 'ROLLBACK', notes: 'تم التراجع للنسخة الاحتياطية بنجاح.' } });
      } else {
        setMigrationResult({ success: false, error: res.error || 'فشل التراجع' });
      }
    } finally {
      setIsMigrating(false);
    }
  };

  const handleRunMigration = async () => {
    setIsMigrating(true);
    setMigrationResult(null);
    try {
      const res = await runMigration();
      if (res.success && res.log) {
        setMigrationResult({ success: true, log: res.log });
      } else {
        setMigrationResult({ success: false, error: res.error || 'فشل الترحيل' });
      }
    } catch (err: any) {
      setMigrationResult({ success: false, error: err.message });
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">إعدادات منظومة أولاد سليم الشاملة</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            إدارة المنشأة، ربط السيرفر المركزي، استيراد الملفات، والنسخ الاحتياطي
          </p>
        </div>
        <img
          src="/awlad-selim-logo.png"
          alt="أولاد سليم"
          className="h-10 w-auto object-contain"
        />
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-1.5 p-1.5 bg-slate-200/80 rounded-2xl overflow-x-auto text-xs font-bold no-print">
        {[
          { key: 'general', label: 'المنشأة والطباعة', icon: Building2, color: 'text-blue-700', perm: 'canManageSettings' },
          { key: 'branches', label: 'الفروع', icon: GitBranch, color: 'text-indigo-700', perm: 'canManageSettings' },
          { key: 'barcode', label: 'إعدادات الباركود', icon: Barcode, color: 'text-slate-700', perm: 'canManageSettings' },
          { key: 'printers', label: 'الطابعات المتعددة', icon: Printer, color: 'text-blue-800', perm: 'canManageSettings' },
          { key: 'invoice-design', label: 'إعدادات الفاتورة', icon: FileText, color: 'text-cyan-700', perm: 'canManageSettings' },
          { key: 'mobile-config', label: 'إعدادات الموبايل', icon: Smartphone, color: 'text-emerald-700', perm: 'canManageSettings' },
          { key: 'online-sync', label: 'مزامنة أونلاين', icon: Wifi, color: 'text-teal-700', perm: 'canManageSettings' },
          { key: 'shortcuts', label: 'اختصارات لوحة المفاتيح', icon: Keyboard, color: 'text-purple-700' },
          { key: 'services', label: 'الخدمات', icon: Wrench, color: 'text-amber-700', perm: 'canManageSettings' },
          { key: 'server', label: 'ربط الأجهزة والسيرفر', icon: Server, color: 'text-emerald-600', perm: 'canManageSettings' },
          { key: 'abu-selim', label: 'استيراد الملفات', icon: FileSpreadsheet, color: 'text-amber-600', perm: 'canManageInventory' },
          { key: 'backup', label: 'النسخ الاحتياطي', icon: Database, color: 'text-purple-600', perm: 'canManageSettings' },
          { key: 'migration', label: 'الترحيل و PostgreSQL', icon: Layers, color: 'text-indigo-600', perm: 'canManageSettings' },
        ]
          .filter((t) => !t.perm || currentUser?.role === 'admin' || hasPermission(t.perm as any))
          .map((tab) => {
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as SettingsTabKey)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
                  activeTab === tab.key ? 'bg-white text-blue-950 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <TabIcon className={`w-4 h-4 ${tab.color}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
      </div>

      {isSaved && (
        <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{savedNotice}</span>
        </div>
      )}

      {restoreSuccess && (
        <div className="p-3 bg-emerald-50 text-emerald-900 border border-emerald-300 rounded-xl text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{restoreSuccess}</span>
        </div>
      )}

      {/* TAB 1: General Company & Print Settings */}
      {activeTab === 'general' && (
        <form onSubmit={handleSaveGeneral} className="space-y-6 text-xs">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-sm font-black text-slate-900 border-b pb-2 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-900" />
              <span>بيانات منشأة أولاد سليم ورأس الفواتير</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold mb-1">اسم المنشأة التجاري:</label>
                <input
                  type="text"
                  required
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="w-full border rounded-xl p-2.5"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">الشعار والوصف الفرعي:</label>
                <input
                  type="text"
                  value={formData.companySubtitle}
                  onChange={(e) => setFormData({ ...formData, companySubtitle: e.target.value })}
                  className="w-full border rounded-xl p-2.5"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">رقم هاتف المحل / الإدارة 1:</label>
                <input
                  type="text"
                  value={formData.phone1}
                  onChange={(e) => setFormData({ ...formData, phone1: e.target.value })}
                  className="w-full border rounded-xl p-2.5 font-mono"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">رقم هاتف إضافي 2:</label>
                <input
                  type="text"
                  value={formData.phone2}
                  onChange={(e) => setFormData({ ...formData, phone2: e.target.value })}
                  className="w-full border rounded-xl p-2.5 font-mono"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-bold mb-1">عنوان المحل / المقر الرئيسي:</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full border rounded-xl p-2.5"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">السجل التجاري:</label>
                <input
                  type="text"
                  value={formData.commercialRegistration}
                  onChange={(e) => setFormData({ ...formData, commercialRegistration: e.target.value })}
                  className="w-full border rounded-xl p-2.5"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">الرقم الضريبي:</label>
                <input
                  type="text"
                  value={formData.taxNumber}
                  onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
                  className="w-full border rounded-xl p-2.5"
                />
              </div>
            </div>
          </div>

          {/* Printing & Operation Settings */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-sm font-black text-slate-900 border-b pb-2 flex items-center gap-2">
              <Printer className="w-4 h-4 text-blue-900" />
              <span>إعدادات الفواتير والطباعة والعمليات</span>
            </h3>

            <div>
              <label className="block font-bold mb-2">نوع الطباعة الافتراضي عند إصدار الفاتورة:</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, defaultPrintMode: 'a4' })}
                  className={`p-3 border rounded-xl font-bold transition-all cursor-pointer ${
                    formData.defaultPrintMode === 'a4' ? 'bg-blue-900 text-white shadow-xs' : 'bg-slate-50 text-slate-700'
                  }`}
                >
                  ورق قياسي A4 (مفصل)
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, defaultPrintMode: 'thermal80' })}
                  className={`p-3 border rounded-xl font-bold transition-all cursor-pointer ${
                    formData.defaultPrintMode === 'thermal80' ? 'bg-blue-900 text-white shadow-xs' : 'bg-slate-50 text-slate-700'
                  }`}
                >
                  طابعة إيصالات حرارية 80 مم
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, defaultPrintMode: 'thermal58' })}
                  className={`p-3 border rounded-xl font-bold transition-all cursor-pointer ${
                    formData.defaultPrintMode === 'thermal58' ? 'bg-blue-900 text-white shadow-xs' : 'bg-slate-50 text-slate-700'
                  }`}
                >
                  طابعة حرارية 58 مم (بلوتوث محمول)
                </button>
              </div>
            </div>

            <div>
              <label className="block font-bold mb-1">الشروط والملاحظات المطبوعة أسفل الفاتورة:</label>
              <textarea
                rows={2}
                value={formData.invoiceNotes}
                onChange={(e) => setFormData({ ...formData, invoiceNotes: e.target.value })}
                className="w-full border rounded-xl p-2.5"
              />
            </div>

            <div className="pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.allowNegativeStock}
                  onChange={(e) => setFormData({ ...formData, allowNegativeStock: e.target.checked })}
                  className="w-4 h-4 rounded text-blue-900"
                />
                <span className="font-bold text-slate-800">
                  السماح بالبيع بالسالب (تجاوز رصيد المخزن في حالات الطوارئ)
                </span>
              </label>
            </div>

            <div className="flex justify-end pt-3">
              <button
                type="submit"
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-black rounded-xl shadow-md cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>حفظ الإعدادات</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* TAB 2: Smart Connection Modes, Server Hub, QR Pairing & Devices Management */}
      {activeTab === 'server' && (
        <div className="space-y-6 text-xs">
          {/* Status summary banner */}
          <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl border border-slate-800">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold block mb-1">
                  السيرفر المركزي الرئيسي (قاعدة البيانات الوحيدة للنظام)
                </span>
                <h3 className="text-base font-black flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </span>
                  <span>
                    {connectionConfig.localNetwork?.hostname || serverForm.hostname} — {getConnectionModeLabel(connectionConfig.activeMode)}
                  </span>
                </h3>
                <div dir="ltr" className="font-mono text-xs text-sky-300 mt-1 break-all">
                  {resolveModeEndpointUrl(connectionConfig.activeMode || 'local_network', connectionConfig) || discoverySnapshot?.activeEndpoint || serverForm.apiBaseUrl}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTestingServer}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isTestingServer ? 'animate-spin' : ''}`} />
                  <span>{isTestingServer ? 'جاري الفحص...' : 'اختبار السيرفر الآن'}</span>
                </button>
                {currentUser?.role === 'admin' && (
                  <button
                    type="button"
                    disabled={broadcastingUpdate}
                    onClick={handleBroadcastUpdate}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold cursor-pointer disabled:opacity-50"
                  >
                    {broadcastingUpdate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    <span>تعميم العنوان للأجهزة</span>
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mt-5 pt-4 border-t border-slate-800 text-[11px]">
              <div className="p-2.5 rounded-xl bg-slate-800/60">
                <span className="text-slate-400 block text-[10px]">حالة السيرفر المركزي:</span>
                <strong className="text-emerald-400 font-bold">
                  {discoverySnapshot?.ok || serverTestResult?.success ? 'يعمل بنشاط (Online)' : 'قيد الفحص'}
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-800/60">
                <span className="text-slate-400 block text-[10px]">نوع ووضع الاتصال:</span>
                <strong className="text-white font-bold">{getConnectionModeLabel(connectionConfig.activeMode)}</strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-800/60">
                <span className="text-slate-400 block text-[10px]">حالة الإنترنت:</span>
                <strong className={typeof navigator !== 'undefined' && navigator.onLine ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                  {typeof navigator !== 'undefined' && navigator.onLine ? 'متصل بالشبكة' : 'بدون إنترنت (محلي)'}
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-800/60">
                <span className="text-slate-400 block text-[10px]">حالة النفق الخارجي:</span>
                <strong className={tunnelRuntime?.status === 'online' ? 'text-emerald-400 font-bold' : 'text-slate-300 font-bold'}>
                  {tunnelRuntime?.status === 'online'
                    ? 'متصل (HTTPS)'
                    : tunnelRuntime?.status === 'starting'
                    ? 'جاري البدء...'
                    : tunnelRuntime?.status === 'error'
                    ? 'خطأ / إعادة محاولة'
                    : 'متوقف'}
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-800/60">
                <span className="text-slate-400 block text-[10px]">المنفذ المستخدم (Port):</span>
                <strong className="font-mono text-amber-300 font-bold">
                  {serverRuntimeInfo?.port || discoverySnapshot?.port || connectionConfig.localNetwork?.port || 3000}
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-800/60">
                <span className="text-slate-400 block text-[10px]">الاستضافة / التوجيه:</span>
                <strong className="font-mono text-sky-300 font-bold">
                  {connectionConfig.deploymentProfile?.hostingLocation === 'cloud_vps' ? 'VPS' : 'Laptop'} • v{connectionConfig.configVersion || 1}
                </strong>
              </div>
            </div>

            {serverTestResult && (
              <div className={`mt-4 p-3 rounded-xl border flex items-center gap-2 ${
                serverTestResult.success
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                  : 'bg-red-950/60 border-red-500/40 text-red-200'
              }`}>
                {serverTestResult.success ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" /> : <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />}
                <span>{serverTestResult.message}</span>
              </div>
            )}
          </div>

          {/* Windows Electron Central Server & Opt-in Tunnel Controls */}
          {desktopInfo?.isElectron && (
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="font-black text-slate-900 flex items-center gap-2 text-sm">
                    <Monitor className="w-4 h-4 text-emerald-700" />
                    <span>تحكم خادم اللابتوب المركزي (Windows Desktop)</span>
                  </h4>
                  <p className="text-slate-600 text-[11px] mt-1">
                    مجلد قاعدة البيانات الوحيدة: <span className="font-mono font-bold text-slate-900" dir="ltr">{desktopInfo.dataDir}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => window.awladDesktop?.openDataFolder()}
                    className="px-3 py-1.5 bg-white border border-emerald-300 text-emerald-800 rounded-xl font-bold hover:bg-emerald-100 cursor-pointer"
                  >
                    فتح مجلد البيانات
                  </button>
                  <button
                    type="button"
                    onClick={() => window.awladDesktop?.openBackupsFolder()}
                    className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-xl font-bold hover:bg-slate-100 cursor-pointer"
                  >
                    فتح النسخ الاحتياطية
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-emerald-200/80">
                <div className="p-3.5 rounded-xl bg-white border border-emerald-200 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-black text-slate-900">التشغيل التلقائي مع بدء Windows</div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {autoStartState.supported
                        ? 'يشغّل السيرفر تلقائياً في الخلفية عند تشغيل اللابتوب لخدمة تطبيقات الهاتف.'
                        : 'متاح على أجهزة Windows و macOS فقط.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!autoStartState.supported || autoStartState.busy}
                    onClick={() => handleToggleAutoStart(!autoStartState.openAtLogin)}
                    className={`px-3.5 py-2 rounded-xl font-black text-xs cursor-pointer disabled:opacity-50 shrink-0 ${
                      autoStartState.openAtLogin
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-100 text-slate-700 border border-slate-300'
                    }`}
                  >
                    {autoStartState.openAtLogin ? 'مفعّل' : 'غير مفعّل'}
                  </button>
                </div>

                <div className="p-3.5 rounded-xl bg-white border border-emerald-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-black text-slate-900 flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-emerald-700" />
                      <span>إدارة نفق Cloudflare (تشغيل اختياري للمدير فقط)</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${tunnelRuntime?.status === 'online' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                      {tunnelRuntime?.status === 'online' ? 'شغّال' : tunnelRuntime?.status === 'starting' ? 'جاري البدء' : 'متوقف'}
                    </span>
                  </div>
                  {tunnelRuntime?.tunnelUrl && (
                    <div dir="ltr" className="font-mono text-[11px] text-emerald-800 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-200 break-all">
                      {tunnelRuntime.tunnelUrl}
                    </div>
                  )}
                  {tunnelActionError && (
                    <div className="text-[11px] font-bold text-red-700 bg-red-50 p-2 rounded-lg border border-red-200">
                      {tunnelActionError}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={tunnelActionBusy}
                      onClick={() => handleStartDesktopTunnel('free_remote')}
                      className="px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer disabled:opacity-50"
                    >
                      تشغيل Quick Tunnel مجاني
                    </button>
                    {connectionConfig.activeMode === 'pro_remote' && (
                      <button
                        type="button"
                        disabled={tunnelActionBusy || !namedTunnelTokenInput.trim()}
                        onClick={() => handleStartDesktopTunnel('pro_remote')}
                        className="px-3 py-1.5 rounded-xl bg-blue-900 hover:bg-blue-950 text-white font-bold cursor-pointer disabled:opacity-50"
                      >
                        تشغيل Named Tunnel
                      </button>
                    )}
                    {(tunnelRuntime?.status === 'online' || tunnelRuntime?.status === 'starting') && (
                      <button
                        type="button"
                        disabled={tunnelActionBusy}
                        onClick={handleStopDesktopTunnel}
                        className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold cursor-pointer disabled:opacity-50"
                      >
                        إيقاف النفق
                      </button>
                    )}
                  </div>
                  {connectionConfig.activeMode === 'pro_remote' && (
                    <input
                      type="password"
                      dir="ltr"
                      value={namedTunnelTokenInput}
                      onChange={(e) => setNamedTunnelTokenInput(e.target.value)}
                      placeholder={tunnelAutoStart.hasToken ? 'يوجد Token محفوظ مسبقاً (أدخل الجديد فقط للتحديث)' : 'أدخل Cloudflare Named Tunnel Token عند الرغبة في تشغيله'}
                      className="w-full border border-slate-300 rounded-xl px-2.5 py-1.5 font-mono text-[11px]"
                    />
                  )}
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-slate-700">
                      تشغيل النفق تلقائياً عند فتح البرنامج على هذا اللابتوب:
                    </span>
                    <button
                      type="button"
                      disabled={tunnelAutoStart.busy}
                      onClick={() => handleToggleTunnelAutoStart(!tunnelAutoStart.enabled)}
                      className={`px-3 py-1 rounded-lg font-black text-[11px] cursor-pointer disabled:opacity-50 ${
                        tunnelAutoStart.enabled
                          ? 'bg-emerald-700 text-white'
                          : 'bg-slate-100 text-slate-700 border border-slate-300'
                      }`}
                    >
                      {tunnelAutoStart.enabled ? 'تلقائي مفعّل' : 'يدوي فقط'}
                    </button>
                  </div>
                </div>
              </div>

              {Array.isArray(desktopInfo.lanUrls || serverRuntimeInfo?.lanUrls) && (
                <div className="pt-2 border-t border-emerald-200/70 flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-700">عناوين الشبكة المحلية المكتشفة على هذا الجهاز:</span>
                  {(desktopInfo.lanUrls || serverRuntimeInfo?.lanUrls || []).map((entry: { ip: string; url: string }) => (
                    <button
                      key={entry.url}
                      type="button"
                      onClick={() => {
                        setConnectionConfig((prev) => ({
                          ...prev,
                          localNetwork: {
                            ...(prev.localNetwork || { port: 3000 }),
                            ip: entry.ip,
                            port: prev.localNetwork?.port || 3000,
                          },
                        }));
                        window.awladDesktop?.copyText(entry.url);
                        showSavedBanner(`تم تحديد ونسخ عنوان LAN: ${entry.url}`);
                      }}
                      className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg font-mono font-bold text-blue-900 hover:bg-blue-50 cursor-pointer"
                      dir="ltr"
                    >
                      {entry.url}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 4 Connection Modes Configuration Form */}
          <form onSubmit={handleSaveServer} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
              <div>
                <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-emerald-700" />
                  <span>أوضاع الاتصال الأربعة بالسيرفر المركزي</span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  اختر الوضع النشط واضبط عناوين الاتصال المسموحة — تبقى قاعدة البيانات على اللابتوب ولا يتم فرض وضع مدفوع أو مجاني.
                </p>
              </div>
              <label className="flex items-center gap-2 font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={connectionConfig.enforceHttpsForRemote !== false}
                  onChange={(e) => setConnectionConfig({ ...connectionConfig, enforceHttpsForRemote: e.target.checked })}
                  className="w-4 h-4 rounded text-emerald-700"
                />
                <span>إلزام HTTPS لجميع الأوضاع الخارجية</span>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Mode 1: Local Network */}
              <div
                className={`p-4 rounded-2xl border-2 space-y-3 transition-all ${
                  connectionConfig.activeMode === 'local_network'
                    ? 'border-emerald-600 bg-emerald-50/40'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 font-black text-slate-900 cursor-pointer">
                    <input
                      type="radio"
                      name="activeMode"
                      checked={connectionConfig.activeMode === 'local_network'}
                      onChange={() => setConnectionConfig({ ...connectionConfig, activeMode: 'local_network' })}
                    />
                    <span>1. الشبكة المحلية (Local Network LAN)</span>
                  </label>
                  <Wifi className="w-4 h-4 text-emerald-700" />
                </div>
                <p className="text-[11px] text-slate-600">اتصال سريع مباشرة داخل شبكة Wi-Fi المحل عبر IP والمنفذ 3000.</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block font-bold mb-1">عنوان IP المحلي:</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={connectionConfig.localNetwork?.ip || ''}
                      onChange={(e) =>
                        setConnectionConfig({
                          ...connectionConfig,
                          localNetwork: {
                            ...(connectionConfig.localNetwork || { port: 3000 }),
                            ip: e.target.value,
                          },
                        })
                      }
                      placeholder="192.168.1.100"
                      className="w-full border rounded-xl p-2 font-mono text-left"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">المنفذ:</label>
                    <input
                      type="number"
                      dir="ltr"
                      value={connectionConfig.localNetwork?.port || 3000}
                      onChange={(e) =>
                        setConnectionConfig({
                          ...connectionConfig,
                          localNetwork: {
                            ...(connectionConfig.localNetwork || { ip: '192.168.1.100', port: 3000 }),
                            port: Number(e.target.value) || 3000,
                          },
                        })
                      }
                      className="w-full border rounded-xl p-2 font-mono text-left"
                    />
                  </div>
                </div>
                {Array.isArray(discoverySnapshot?.lanUrls) && discoverySnapshot.lanUrls.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {discoverySnapshot.lanUrls.map((u) => {
                      const ipOnly = u.replace(/^https?:\/\//, '').split(':')[0];
                      return (
                        <button
                          key={u}
                          type="button"
                          onClick={() =>
                            setConnectionConfig({
                              ...connectionConfig,
                              localNetwork: { ...(connectionConfig.localNetwork || { port: 3000 }), ip: ipOnly, port: Number(discoverySnapshot.port || 3000) },
                            })
                          }
                          className="px-2 py-0.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-mono text-[10px] cursor-pointer"
                          dir="ltr"
                        >
                          {ipOnly}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => handleTestModeEndpoint('local_network')}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-slate-800 cursor-pointer"
                  >
                    {modeEndpointTests.local_network?.testing ? 'جاري الفحص...' : 'اختبار الشبكة المحلية'}
                  </button>
                  {modeEndpointTests.local_network?.message && (
                    <span className={`text-[10px] font-bold ${modeEndpointTests.local_network.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                      {modeEndpointTests.local_network.message}
                    </span>
                  )}
                </div>
              </div>

              {/* Mode 2: Free Remote */}
              <div
                className={`p-4 rounded-2xl border-2 space-y-3 transition-all ${
                  connectionConfig.activeMode === 'free_remote'
                    ? 'border-emerald-600 bg-emerald-50/40'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 font-black text-slate-900 cursor-pointer">
                    <input
                      type="radio"
                      name="activeMode"
                      checked={connectionConfig.activeMode === 'free_remote'}
                      onChange={() => setConnectionConfig({ ...connectionConfig, activeMode: 'free_remote' })}
                    />
                    <span>2. الاتصال الخارجي المجاني (Quick Tunnel)</span>
                  </label>
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                </div>
                <p className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-2 font-bold">
                  تنبيه مهم: رابط Cloudflare Quick Tunnel مؤقت وقد يتغير عند كل إعادة تشغيل للنفق ولا يُعد رابطاً ثابتاً دائماً.
                </p>
                <div>
                  <label className="block font-bold mb-1">رابط النفق (HTTPS):</label>
                  <input
                    type="url"
                    dir="ltr"
                    value={connectionConfig.freeRemote?.tunnelUrl || ''}
                    onChange={(e) =>
                      setConnectionConfig({
                        ...connectionConfig,
                        freeRemote: { ...(connectionConfig.freeRemote || {}), tunnelUrl: e.target.value },
                      })
                    }
                    placeholder="https://xxxx-xxxx.trycloudflare.com"
                    className="w-full border rounded-xl p-2 font-mono text-left"
                  />
                </div>
                <div className="flex items-center justify-between pt-1 gap-2">
                  <button
                    type="button"
                    onClick={() => handleTestModeEndpoint('free_remote')}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-slate-800 cursor-pointer"
                  >
                    {modeEndpointTests.free_remote?.testing ? 'جاري الفحص...' : 'اختبار رابط النفق'}
                  </button>
                  {modeEndpointTests.free_remote?.message && (
                    <span className={`text-[10px] font-bold ${modeEndpointTests.free_remote.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                      {modeEndpointTests.free_remote.message}
                    </span>
                  )}
                </div>
              </div>

              {/* Mode 3: Pro Remote */}
              <div
                className={`p-4 rounded-2xl border-2 space-y-3 transition-all ${
                  connectionConfig.activeMode === 'pro_remote'
                    ? 'border-emerald-600 bg-emerald-50/40'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 font-black text-slate-900 cursor-pointer">
                    <input
                      type="radio"
                      name="activeMode"
                      checked={connectionConfig.activeMode === 'pro_remote'}
                      onChange={() => setConnectionConfig({ ...connectionConfig, activeMode: 'pro_remote' })}
                    />
                    <span>3. الاتصال الاحترافي بدومين ثابت (Pro Remote)</span>
                  </label>
                  <KeyRound className="w-4 h-4 text-blue-800" />
                </div>
                <p className="text-[11px] text-slate-600">
                  Cloudflare Named Tunnel أو Reverse Proxy بدومين HTTPS ثابت مع فحص صارم لشهادة TLS.
                </p>
                <div>
                  <label className="block font-bold mb-1">الدومين الثابت (HTTPS):</label>
                  <input
                    type="url"
                    dir="ltr"
                    value={connectionConfig.proRemote?.domainUrl || ''}
                    onChange={(e) =>
                      setConnectionConfig({
                        ...connectionConfig,
                        proRemote: { ...(connectionConfig.proRemote || {}), domainUrl: e.target.value },
                      })
                    }
                    placeholder="https://erp.example.com"
                    className="w-full border rounded-xl p-2 font-mono text-left"
                  />
                </div>
                <div className="flex items-center justify-between pt-1 gap-2">
                  <button
                    type="button"
                    onClick={() => handleTestModeEndpoint('pro_remote')}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 font-bold text-slate-800 cursor-pointer"
                  >
                    {modeEndpointTests.pro_remote?.testing ? 'جاري الفحص...' : 'اختبار الشهادة والدومين'}
                  </button>
                  {modeEndpointTests.pro_remote?.message && (
                    <span className={`text-[10px] font-bold ${modeEndpointTests.pro_remote.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                      {modeEndpointTests.pro_remote.message}
                    </span>
                  )}
                </div>
              </div>

              {/* Mode 4: Cloud VPS */}
              <div
                className={`p-4 rounded-2xl border-2 space-y-3 transition-all ${
                  connectionConfig.activeMode === 'cloud_vps'
                    ? 'border-emerald-600 bg-emerald-50/40'
                    : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 font-black text-slate-900 cursor-pointer">
                    <input
                      type="radio"
                      name="activeMode"
                      checked={connectionConfig.activeMode === 'cloud_vps'}
                      onChange={() => setConnectionConfig({ ...connectionConfig, activeMode: 'cloud_vps' })}
                    />
                    <span>4. سيرفر سحابي خارجي (Cloud VPS)</span>
                  </label>
                  <Cloud className="w-4 h-4 text-indigo-700" />
                </div>
                <p className="text-[11px] text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-xl p-2 font-bold">
                  يُختبر الاتصال بالسيرفر قبل الحفظ والتعميم — لا يتم إنشاء أو نقل قاعدة بيانات جديدة تلقائياً.
                </p>
                <div>
                  <label className="block font-bold mb-1">رابط سيرفر VPS (HTTPS):</label>
                  <input
                    type="url"
                    dir="ltr"
                    value={connectionConfig.cloudVps?.vpsUrl || ''}
                    onChange={(e) => {
                      setVpsTestedUrl('');
                      setConnectionConfig({
                        ...connectionConfig,
                        cloudVps: { ...(connectionConfig.cloudVps || {}), vpsUrl: e.target.value },
                      });
                    }}
                    placeholder="https://vps.example.com"
                    className="w-full border rounded-xl p-2 font-mono text-left"
                  />
                </div>
                <div className="flex items-center justify-between pt-1 gap-2">
                  <button
                    type="button"
                    onClick={() => handleTestModeEndpoint('cloud_vps')}
                    className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 font-bold text-indigo-900 cursor-pointer"
                  >
                    {modeEndpointTests.cloud_vps?.testing ? 'جاري اختبار VPS...' : 'اختبار اتصال VPS قبل الحفظ'}
                  </button>
                  {modeEndpointTests.cloud_vps?.message && (
                    <span className={`text-[10px] font-bold ${modeEndpointTests.cloud_vps.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                      {modeEndpointTests.cloud_vps.message}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Deployment Separation (Hosting / Domain / Optional Plan) + App Download Fallback Links */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
              <div>
                <h4 className="font-black text-slate-900 text-xs">
                  فصل الاستضافة والدومين والباقة + روابط تنزيل التطبيق عند عدم تثبيته
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  بيانات تنظيمية مستقلة لمرونة التبديل بين المجاني والاحترافي وVPS دون فرض أي باقة أو عمليات دفع تلقائية.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block font-bold mb-1 text-slate-700">مكان الاستضافة الفعلي:</label>
                  <select
                    value={connectionConfig.deploymentProfile?.hostingLocation || 'laptop_windows'}
                    onChange={(e) =>
                      setConnectionConfig({
                        ...connectionConfig,
                        deploymentProfile: {
                          ...(connectionConfig.deploymentProfile || {}),
                          hostingLocation: e.target.value as any,
                        },
                      })
                    }
                    className="w-full border border-slate-300 rounded-xl p-2 bg-white font-bold"
                  >
                    <option value="laptop_windows">لابتوب المتجر (Windows Server)</option>
                    <option value="local_server">خادم محلي ثابت بالمقر</option>
                    <option value="cloud_vps">خادم سحابي مستقل (VPS)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1 text-slate-700">نوع الدومين المستخدم:</label>
                  <select
                    value={connectionConfig.deploymentProfile?.domainType || 'none'}
                    onChange={(e) =>
                      setConnectionConfig({
                        ...connectionConfig,
                        deploymentProfile: {
                          ...(connectionConfig.deploymentProfile || {}),
                          domainType: e.target.value as any,
                        },
                      })
                    }
                    className="w-full border border-slate-300 rounded-xl p-2 bg-white font-bold"
                  >
                    <option value="none">بدون دومين (شبكة محلية فقط)</option>
                    <option value="trycloudflare">نطاق مجاني (*.trycloudflare.com)</option>
                    <option value="custom_domain">دومين خاص مملوك للعميل</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1 text-slate-700">الباقة التنظيمية (اختيارية):</label>
                  <select
                    value={connectionConfig.deploymentProfile?.planTier || 'free'}
                    onChange={(e) =>
                      setConnectionConfig({
                        ...connectionConfig,
                        deploymentProfile: {
                          ...(connectionConfig.deploymentProfile || {}),
                          planTier: e.target.value as any,
                        },
                      })
                    }
                    className="w-full border border-slate-300 rounded-xl p-2 bg-white font-bold"
                  >
                    <option value="free">محلي / مجاني (بدون اشتراك)</option>
                    <option value="pro">اتصال احترافي بدومين</option>
                    <option value="enterprise_vps">استضافة سحابية VPS</option>
                    <option value="self_hosted">تشغيل ذاتي مخصص</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1 text-slate-700">حالة الاشتراك (معلوماتية):</label>
                  <select
                    value={connectionConfig.deploymentProfile?.subscriptionStatus || 'none'}
                    onChange={(e) =>
                      setConnectionConfig({
                        ...connectionConfig,
                        deploymentProfile: {
                          ...(connectionConfig.deploymentProfile || {}),
                          subscriptionStatus: e.target.value as any,
                        },
                      })
                    }
                    className="w-full border border-slate-300 rounded-xl p-2 bg-white font-bold"
                  >
                    <option value="none">غير مطبق (تشغيل مجاني/ذاتي)</option>
                    <option value="active">نشط</option>
                    <option value="trial">فترة تجريبية</option>
                    <option value="paused">متوقف مؤقتاً</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-200">
                <div>
                  <label className="block font-bold mb-1 text-slate-700">رابط تنزيل Android APK (اختياري):</label>
                  <input
                    type="url"
                    dir="ltr"
                    value={connectionConfig.appDownloadUrls?.androidApkUrl || ''}
                    onChange={(e) =>
                      setConnectionConfig({
                        ...connectionConfig,
                        appDownloadUrls: {
                          ...(connectionConfig.appDownloadUrls || {}),
                          androidApkUrl: e.target.value,
                        },
                      })
                    }
                    placeholder="https://example.com/awlad-selim.apk"
                    className="w-full border border-slate-300 rounded-xl p-2 bg-white font-mono text-left"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1 text-slate-700">رابط تنزيل iPhone (TestFlight / Store):</label>
                  <input
                    type="url"
                    dir="ltr"
                    value={connectionConfig.appDownloadUrls?.iosStoreUrl || ''}
                    onChange={(e) =>
                      setConnectionConfig({
                        ...connectionConfig,
                        appDownloadUrls: {
                          ...(connectionConfig.appDownloadUrls || {}),
                          iosStoreUrl: e.target.value,
                        },
                      })
                    }
                    placeholder="https://testflight.apple.com/join/..."
                    className="w-full border border-slate-300 rounded-xl p-2 bg-white font-mono text-left"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1 text-slate-700">رابط تنزيل Windows (اختياري):</label>
                  <input
                    type="url"
                    dir="ltr"
                    value={connectionConfig.appDownloadUrls?.windowsUrl || ''}
                    onChange={(e) =>
                      setConnectionConfig({
                        ...connectionConfig,
                        appDownloadUrls: {
                          ...(connectionConfig.appDownloadUrls || {}),
                          windowsUrl: e.target.value,
                        },
                      })
                    }
                    placeholder="https://example.com/awlad-selim-setup.exe"
                    className="w-full border border-slate-300 rounded-xl p-2 bg-white font-mono text-left"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {currentUser?.role === 'admin' && (
                <button
                  type="button"
                  disabled={broadcastingUpdate}
                  onClick={handleBroadcastUpdate}
                  className="flex items-center gap-2 px-4 py-2.5 bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-200 font-bold rounded-xl cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>{broadcastingUpdate ? 'جاري التعميم...' : 'مشاركة/تعميم الإعدادات للأجهزة المرتبطة'}</span>
                </button>
              )}
              <button
                type="submit"
                disabled={isSavingServer || isTestingServer}
                className="flex items-center gap-2 px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-black rounded-xl shadow-md cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{isSavingServer ? 'جاري الحفظ...' : 'حفظ وتفعيل وضع الاتصال المختار'}</span>
              </button>
            </div>
          </form>

          {/* Pairing & Connected Devices Panel (Admin Only) */}
          {currentUser?.role === 'admin' ? (
            <PairingAndDevicesPanel
              users={users}
              activeMode={(connectionConfig.activeMode || 'local_network') as ConnectionMode}
              activeEndpoint={
                resolveModeEndpointUrl(connectionConfig.activeMode || 'local_network', connectionConfig) ||
                discoverySnapshot?.activeEndpoint ||
                ''
              }
              profiles={connectionConfig}
              onShowToast={showSavedBanner}
            />
          ) : (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 font-bold">
              إنشاء روابط الربط السريع وإدارة الأجهزة المرتبطة متاحة لمدير النظام العام (Admin) فقط.
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Abu Selim Product Import (Section 8) */}
      {activeTab === 'abu-selim' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5 text-xs">
          <div className="border-b pb-3">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-amber-600" />
              <span>استيراد وتدقيق ملفات المنتجات (Product Import Engine)</span>
            </h3>
            <p className="text-slate-500 mt-1 leading-relaxed">
              وفق تعليمات الإدارة الصارمة: استخراج أسماء المنتجات والأكواد الأصلية فقط، عدم اختراع بيانات، وترك أسعار الشراء والبيع والكميات والصور فارغة بالكامل (0) لتحديدها لاحقاً بمعرفتكم.
            </p>
          </div>

          {importSuccessCount !== null && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl font-bold flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>تم استيراد ({importSuccessCount}) صنف جديد بنجاح إلى قاعدة البيانات دون أسعار أو كميات مسبقة!</span>
            </div>
          )}

          {importError && (
            <div className="p-3.5 bg-red-50 border border-red-200 text-red-800 rounded-xl font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{importError}</span>
            </div>
          )}

          {deleteImportedReport && (
            <div className="p-4 bg-blue-50 border border-blue-200 text-blue-950 rounded-xl space-y-1.5">
              <div className="font-black flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-700" />
                <span>تم حذف ({deleteImportedReport.deletedCount}) صنف مستورد من الملفات بأمان.</span>
              </div>
              {deleteImportedReport.skippedCount > 0 && (
                <p className="text-[11px] text-amber-800 font-bold">
                  تم الحفاظ على ({deleteImportedReport.skippedCount}) صنف مستورد لارتباطها بفواتير أو حركات سابقة:{' '}
                  {(deleteImportedReport.skippedItems || []).slice(0, 5).map((s) => `${s.name} (${s.code})`).join('، ')}
                  {deleteImportedReport.skippedCount > 5 ? '...' : ''}
                </p>
              )}
            </div>
          )}

          {/* Upload Box */}
          <div className="p-6 border-2 border-dashed border-slate-300 rounded-2xl text-center bg-slate-50/50 hover:bg-slate-50 transition-colors">
            <FileSpreadsheet className="w-10 h-10 text-slate-400 mx-auto mb-2" />
            <p className="font-bold text-slate-800 mb-1">اختر ملف الأصناف (شيبسيات.txt، مشروبات.txt، tool.txt، أو ملفات CSV)</p>
            <p className="text-[11px] text-slate-500 mb-4">يتم فحص وتدقيق الأكواد المكررة تلقائياً وعرض معاينة تفصيلية قبل الاعتماد النهائي</p>
            <label className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-900 hover:bg-blue-950 text-white font-bold rounded-xl cursor-pointer shadow-md transition-all">
              <Upload className="w-4 h-4" />
              <span>اختيار ملف الأصناف للفحص</span>
              <input
                type="file"
                accept=".txt,.csv,.tsv,.sql"
                onChange={handleParseAbuSelimFile}
                className="hidden"
              />
            </label>
            {importFileName && (
              <p className="mt-3 font-mono font-bold text-blue-900 text-xs">الملف المختار: {importFileName}</p>
            )}
          </div>

          {/* Preview Table */}
          {importCandidates.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-800">إجمالي السجلات المكتشفة ({importCandidates.length}):</span>
                  <span className="text-[11px] text-emerald-800 bg-emerald-100/70 px-2.5 py-0.5 rounded-full border border-emerald-300 font-bold">
                    أصناف صالحة: {importCandidates.filter(c => c.isValid).length}
                  </span>
                  {importCandidates.some(c => c.isDuplicateCode) && (
                    <span className="text-[11px] text-red-800 bg-red-100/70 px-2.5 py-0.5 rounded-full border border-red-300 font-bold">
                      أكواد مكررة: {importCandidates.filter(c => c.isDuplicateCode).length}
                    </span>
                  )}
                  {importCandidates.some(c => c.isDuplicateName) && (
                    <span className="text-[11px] text-amber-800 bg-amber-100/70 px-2.5 py-0.5 rounded-full border border-amber-300 font-bold">
                      أسماء مكررة: {importCandidates.filter(c => c.isDuplicateName).length}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCancelImport}
                    className="px-3.5 py-2 border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold rounded-xl cursor-pointer"
                  >
                    إلغاء العملية
                  </button>
                  <button
                    type="button"
                    onClick={handleRequestImportConfirm}
                    disabled={isImportingToDb || importCandidates.filter(c => c.isValid).length === 0}
                    className="flex items-center gap-1.5 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-black rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />
                    <span>{isImportingToDb ? 'جاري الاستيراد...' : 'اعتماد واستيراد الأصناف المعتمدة'}</span>
                  </button>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
                <table className="w-full text-right text-[11px]">
                  <thead className="bg-slate-100 text-slate-700 sticky top-0 border-b">
                    <tr>
                      <th className="p-2">#</th>
                      <th className="p-2">كود الصنف</th>
                      <th className="p-2">اسم الصنف الأصلي</th>
                      <th className="p-2">التصنيف</th>
                      <th className="p-2">سعر الشراء</th>
                      <th className="p-2">سعر البيع</th>
                      <th className="p-2">الرصيد</th>
                      <th className="p-2 text-center">حالة التدقيق</th>
                      <th className="p-2 text-center">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {importCandidates.slice(0, 50).map((cand, idx) => (
                      <tr key={cand.id} className={cand.isValid ? 'hover:bg-slate-50' : 'bg-red-50/50'}>
                        <td className="p-2 text-slate-400 font-mono">{idx + 1}</td>
                        <td className="p-2 font-mono font-bold text-slate-800">{cand.code}</td>
                        <td className="p-2 font-bold text-slate-900">{cand.name}</td>
                        <td className="p-2 text-slate-600">{cand.category}</td>
                        <td className="p-2 text-slate-400 font-mono">0 (فارغ)</td>
                        <td className="p-2 text-slate-400 font-mono">0 (فارغ)</td>
                        <td className="p-2 text-slate-400 font-mono">0 (فارغ)</td>
                        <td className="p-2 text-center">
                          {cand.isValid ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold">صالح</span>
                          ) : cand.isDuplicateCode ? (
                            <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-[10px] font-bold">كود مكرر</span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">اسم مكرر</span>
                          )}
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleExcludeCandidate(cand.id)}
                            className="text-red-600 hover:text-red-800 p-1 text-[10px] font-bold hover:underline"
                            title="استبعاد هذا السجل من الاستيراد"
                          >
                            استبعاد
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {importCandidates.length > 50 && (
                <p className="text-[10px] text-slate-400 text-center">يتم عرض أول 50 صنف من أصل {importCandidates.length} صنف تم فحصها</p>
              )}
            </div>
          )}

          {/* Safe Delete Imported Products Section */}
          <div className="p-4 rounded-2xl bg-red-50/70 border border-red-200 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="font-black text-red-900 flex items-center gap-1.5 text-xs">
                  <Trash2 className="w-4 h-4 text-red-600" />
                  <span>إدارة وحذف الأصناف المستوردة من الملفات ({importedProductsList.length} صنف مستورد)</span>
                </h4>
                <p className="text-[11px] text-red-800/80 mt-0.5">
                  يحذف فقط الأصناف التي تم استيرادها من الملفات ولم تُستخدم في فواتير أو جرد أو تحويلات أو حركات مخزنية غير افتتاحية، مع الحفاظ التام على الأصناف المضافة يدوياً.
                </p>
              </div>
              <button
                type="button"
                disabled={importedProductsList.length === 0 || isDeletingImported}
                onClick={() => setShowDeleteImportedConfirm(true)}
                className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-black text-xs shadow-xs disabled:opacity-40 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>
                  {selectedDeleteBatchId === 'all'
                    ? 'مسح جميع الأصناف المستوردة من الملفات'
                    : 'مسح أصناف الدفعة المحددة فقط'}
                </span>
              </button>
            </div>

            {importBatches.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2 border-t border-red-200/60">
                <label className="text-[11px] font-bold text-red-950 shrink-0">نطاق الحذف:</label>
                <select
                  value={selectedDeleteBatchId}
                  onChange={(e) => setSelectedDeleteBatchId(e.target.value)}
                  className="bg-white border border-red-200 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800"
                >
                  <option value="all">جميع الأصناف المستوردة من الملفات ({importedProductsList.length} صنف)</option>
                  {importBatches
                    .filter((b) => b.batchId !== 'UNBATCHED')
                    .map((b) => (
                      <option key={b.batchId} value={b.batchId}>
                        دفعة: {b.fileName} — {b.batchId} ({b.count} صنف)
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>

          <ConfirmDialog
            isOpen={showImportConfirm}
            onClose={() => setShowImportConfirm(false)}
            onConfirm={handleExecuteImport}
            title="اعتماد استيراد الأصناف من الملف"
            message={`هل أنت متأكد من استيراد (${importCandidates.filter(c => c.isValid).length}) صنف جديد من ملف (${importFileName})؟`}
            confirmLabel="استيراد وحفظ الأصناف"
            variant="info"
            isLoading={isImportingToDb}
          />

          <ConfirmDialog
            isOpen={showDeleteImportedConfirm}
            onClose={() => setShowDeleteImportedConfirm(false)}
            onConfirm={handleExecuteDeleteImported}
            title={selectedDeleteBatchId === 'all' ? 'مسح جميع الأصناف المستوردة من الملفات' : 'مسح أصناف دفعة الاستيراد المحددة'}
            message={(() => {
              const targetCount =
                selectedDeleteBatchId === 'all'
                  ? importedProductsList.length
                  : importBatches.find((b) => b.batchId === selectedDeleteBatchId)?.count || importedProductsList.length;
              return `سيتم حذف الأصناف المستوردة (${targetCount} صنف في النطاق المحدد) بشرط عدم ارتباطها بأي فواتير أو مرتجعات أو طلبات أو جرد أو تحويلات أو حركات مخزنية. الأصناف المضافة يدوياً أو المرتبطة بحركات لن تُحذف. هل تريد المتابعة؟`;
            })()}
            confirmLabel="نعم، مسح الأصناف غير المستخدمة"
            variant="danger"
            isLoading={isDeletingImported}
          />
        </div>
      )}

      {/* TAB 5: Backup & Restore */}
      {activeTab === 'backup' && (
        <div className="space-y-6 text-xs">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 text-xs">
            <h3 className="text-sm font-black text-slate-900 border-b pb-2 flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-900" />
              <span>النسخ الاحتياطي واستعادة قاعدة البيانات (Backup & Recovery)</span>
            </h3>
            <p className="text-slate-500 leading-relaxed">
              يمكنك في أي وقت تنزيل نسخة احتياطية كاملة ومأمونة من كافة فواتير المبيعات، المشتريات، حركة الخزائن، حسابات العملاء والموردين بصيغة JSON، واستعادتها على أي جهاز كمبيوتر أو هاتف محمول.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              {/* Download Backup */}
              <div className="p-4 bg-slate-50 border rounded-2xl space-y-3">
                <h4 className="font-bold text-slate-900 flex items-center gap-2">
                  <Download className="w-4 h-4 text-blue-900" />
                  <span>تصدير نسخة احتياطية كاملة</span>
                </h4>
                <p className="text-[11px] text-slate-500">
                  توليد ملف مشفر ومفصل لجميع قيود المنظومة لحفظه على قرص خارجي أو فلاش ميموري
                </p>
                <button
                  type="button"
                  onClick={exportBackup}
                  className="w-full py-2.5 px-4 bg-blue-900 hover:bg-blue-950 text-white font-bold rounded-xl shadow-xs text-center cursor-pointer"
                >
                  تنزيل ملف النسخة الاحتياطية الآن
                </button>
              </div>

              {/* Restore Backup */}
              <div className="p-4 bg-slate-50 border rounded-2xl space-y-3">
                <h4 className="font-bold text-slate-900 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-700" />
                  <span>استعادة نسخة احتياطية سابقة</span>
                </h4>
                <p className="text-[11px] text-slate-500">
                  رفع ملف النسخة الاحتياطية (JSON) واسترجاع كامل العمليات والأرصدة بأمان
                </p>
                <label className="w-full block py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-center cursor-pointer shadow-xs">
                  <span>اختر ملف النسخة واستعادتها</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Migration Log and PostgreSQL Management Tab */}
      {activeTab === 'migration' && (
        <div className="space-y-6 text-xs animate-in fade-in duration-200">
          {/* PostgreSQL Engine & Health Banner */}
          <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl border border-slate-800">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-indigo-400 font-bold block mb-1">
                  قاعدة البيانات المركزية والخادم المحلي (PostgreSQL Relational Engine)
                </span>
                <h3 className="text-base font-black flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
                  </span>
                  <span>PostgreSQL 16 Enterprise · awlad_selim · 20 مستخدم متزامن</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  نظام المعاملات المالية والمخزنية المتسقة (ACID Transactions)، المفاتيح الأجنبية، الفهارس وسجلات التدقيق المتقدمة.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCheckPostgres}
                  disabled={isTestingPg}
                  className="flex items-center gap-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTestingPg ? 'animate-spin' : ''}`} />
                  <span>{isTestingPg ? 'جاري الفحص...' : 'فحص اتصال PostgreSQL'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleRunMigration}
                  disabled={isMigrating}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black shadow-lg shadow-indigo-600/30 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  <ArrowLeftRight className={`w-4 h-4 ${isMigrating ? 'animate-spin' : ''}`} />
                  <span>{isMigrating ? 'جاري الترحيل والتحقق...' : 'تشغيل فحص وترحيل البيانات'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleRollbackMigration}
                  disabled={isMigrating}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>التراجع لآخر نسخة احتياطية</span>
                </button>
              </div>
            </div>

            {/* Diagnostic stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-4 border-t border-slate-800 text-[11px]">
              <div className="p-3 rounded-xl bg-slate-800/60">
                <span className="text-slate-400 block text-[10px]">حالة المحرك:</span>
                <strong className={pgHealthInfo?.status === 'online' ? 'text-emerald-400 font-bold' : 'text-amber-300 font-bold'}>
                  {pgHealthInfo?.status === 'online'
                    ? 'PostgreSQL متصل ويعمل'
                    : pgHealthInfo?.status === 'connection_failed'
                    ? 'تعذر الاتصال بـ PostgreSQL (السجلات المحلية تعمل)'
                    : 'PostgreSQL غير مُعدّ بعد (السجلات المحلية الآمنة تعمل)'}
                </strong>
              </div>
              <div className="p-3 rounded-xl bg-slate-800/60">
                <span className="text-slate-400 block text-[10px]">استجابة الاتصال:</span>
                <strong className="text-emerald-400 font-mono font-bold">
                  {pgHealthInfo?.latencyMs ? `${pgHealthInfo.latencyMs} ms` : 'محلي (0 ms)'}
                </strong>
              </div>
              <div className="p-3 rounded-xl bg-slate-800/60">
                <span className="text-slate-400 block text-[10px]">قاعدة البيانات:</span>
                <strong className="text-slate-200 font-mono font-bold">
                  {pgHealthInfo?.databaseName || 'awlad_selim (v3.0)'}
                </strong>
              </div>
              <div className="p-3 rounded-xl bg-slate-800/60">
                <span className="text-slate-400 block text-[10px]">المعاملات المالية:</span>
                <strong className="text-emerald-400 font-bold">ACID Enabled / Idempotent</strong>
              </div>
            </div>

            {pgHealthInfo && (
              <div className={`mt-3 p-3 rounded-xl text-xs ${pgHealthInfo.status === 'online' ? 'bg-emerald-950/60 text-emerald-200 border border-emerald-800/60' : 'bg-slate-800/90 text-amber-200 border border-amber-700/40'}`}>
                <p><strong>نتيجة الفحص:</strong> {pgHealthInfo.message}</p>
                {pgHealthInfo.status !== 'online' && (
                  <p className="text-[11px] text-slate-300 mt-1">
                    ملاحظة: تبقى جميع بياناتك الحالية محفوظة بالكامل دون حذف أو تصفير. لن يبدأ الترحيل الفعلي إلا بعد إعداد متغيرات اتصال PostgreSQL وتشغيل الخدمة وأخذ نسخة احتياطية تلقائية.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Live Migration Result Card */}
          {migrationResult && (
            <div className={`p-5 rounded-2xl border ${
              migrationResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-950' : 'bg-red-50 border-red-200 text-red-950'
            } shadow-xs space-y-3`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {migrationResult.success ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-600" />
                  )}
                  <h4 className="font-black text-sm">
                    {migrationResult.success ? 'تم فحص وترحيل البيانات وتوثيقها في سجل الترحيل بنجاح!' : 'تعذر تنفيذ الترحيل'}
                  </h4>
                </div>
                {migrationResult.log?.id && (
                  <span className={`font-mono text-xs font-bold bg-white/80 px-2.5 py-1 rounded-lg border ${migrationResult.success ? 'border-emerald-300' : 'border-red-300'}`}>
                    {migrationResult.log.id}
                  </span>
                )}
              </div>

              <p className={`text-xs leading-relaxed font-semibold ${migrationResult.success ? 'text-emerald-800' : 'text-red-800'}`}>
                {migrationResult.success ? migrationResult.log?.notes : migrationResult.error}
              </p>

              {(() => {
                const warnings = migrationResult.log?.details?.warnings || migrationResult.log?.warnings;
                return Array.isArray(warnings) && warnings.length > 0 ? (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 space-y-1">
                    <strong className="block">تحذيرات الترحيل وربط العملاء:</strong>
                    {warnings.map((w: string, idx: number) => (
                      <div key={idx}>• {w}</div>
                    ))}
                  </div>
                ) : null;
              })()}

              {/* Breakdown Grid */}
              {migrationResult.log?.details && (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 pt-2">
                  <div className="p-2 bg-white rounded-xl border border-emerald-200 text-center">
                    <span className="text-[10px] text-slate-500 block">المستخدمون</span>
                    <strong className="text-sm font-black text-emerald-900 font-mono">{migrationResult.log.details.users}</strong>
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-emerald-200 text-center">
                    <span className="text-[10px] text-slate-500 block">العملاء</span>
                    <strong className="text-sm font-black text-emerald-900 font-mono">{migrationResult.log.details.customers}</strong>
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-emerald-200 text-center">
                    <span className="text-[10px] text-slate-500 block">الموردون</span>
                    <strong className="text-sm font-black text-emerald-900 font-mono">{migrationResult.log.details.suppliers}</strong>
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-emerald-200 text-center">
                    <span className="text-[10px] text-slate-500 block">الأصناف والسلع</span>
                    <strong className="text-sm font-black text-emerald-900 font-mono">{migrationResult.log.details.products}</strong>
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-emerald-200 text-center">
                    <span className="text-[10px] text-slate-500 block">المستودعات</span>
                    <strong className="text-sm font-black text-emerald-900 font-mono">{migrationResult.log.details.warehouses}</strong>
                  </div>
                  <div className="p-2 bg-white rounded-xl border border-emerald-200 text-center">
                    <span className="text-[10px] text-slate-500 block">الفواتير والدفعات</span>
                    <strong className="text-sm font-black text-emerald-900 font-mono">{migrationResult.log.details.invoices + (migrationResult.log.details.payments || 0)}</strong>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Migration Logs History Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <span>سجل الترحيل التاريخي (Migration Logs)</span>
                </h4>
                <p className="text-[11px] text-slate-500">
                  توثيق عمليات الترحيل السابقة، نسب المطابقة، عدد السجلات، وهوية المنفذ
                </p>
              </div>
              <span className="text-xs font-bold text-slate-600 font-mono">
                إجمالي العمليات: {(migrationLogs || []).length}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="bg-slate-100/70 text-slate-700 font-bold border-b border-slate-200">
                    <th className="p-3">رقم العملية</th>
                    <th className="p-3">التاريخ والوقت</th>
                    <th className="p-3">المصدر</th>
                    <th className="p-3">الوجهة</th>
                    <th className="p-3 text-center">إجمالي السجلات</th>
                    <th className="p-3 text-center">المنقول بنجاح</th>
                    <th className="p-3 text-center">الفاشل / المرفوض</th>
                    <th className="p-3 text-center">الحالة</th>
                    <th className="p-3">المنفذ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(!migrationLogs || migrationLogs.length === 0) ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-400">
                        لا توجد عمليات ترحيل مسجلة بعد. اضغط على "تشغيل فحص وترحيل البيانات" بالأعلى لإجراء عملية ترحيل وتوثيق أولى.
                      </td>
                    </tr>
                  ) : (
                    migrationLogs.map(log => (
                      <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 font-mono font-bold text-indigo-900">{log.id}</td>
                        <td className="p-3 font-mono text-slate-600 text-[11px]">
                          {new Date(log.timestamp).toLocaleString('ar-EG')}
                        </td>
                        <td className="p-3 text-slate-600 text-[11px]">{log.source}</td>
                        <td className="p-3 text-slate-700 font-bold text-[11px]">{log.destination}</td>
                        <td className="p-3 text-center font-mono font-bold text-slate-800">{log.totalRecords}</td>
                        <td className="p-3 text-center font-mono font-black text-emerald-600">{log.migratedRecords}</td>
                        <td className="p-3 text-center font-mono font-bold text-red-600">{log.failedRecords}</td>
                        <td className="p-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            log.status === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                            log.status === 'pending' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                            'bg-red-50 text-red-700 border border-red-200'
                          }`}>
                            {log.status === 'success' ? 'ناجح 100%' : log.status === 'pending' ? 'قيد التنفيذ' : 'تحذير'}
                          </span>
                        </td>
                        <td className="p-3 text-slate-600 font-semibold">{log.executedBy}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {/* TAB: Branches Management */}
      {activeTab === 'branches' && (
        <div className="space-y-4 text-xs">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-sm font-black text-slate-900 border-b pb-2 flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-blue-900" />
              <span>إدارة الفروع ونقاط التوزيع</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input type="text" placeholder="اسم الفرع *" value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} className="border rounded-xl p-2 font-bold" />
              <input type="text" placeholder="كود الفرع (BR-02)" value={newBranchCode} onChange={(e) => setNewBranchCode(e.target.value)} className="border rounded-xl p-2 font-mono" />
              <input type="text" placeholder="رقم الهاتف" value={newBranchPhone} onChange={(e) => setNewBranchPhone(e.target.value)} className="border rounded-xl p-2 font-mono" />
              <input type="text" placeholder="العنوان التفصيلي" value={newBranchAddress} onChange={(e) => setNewBranchAddress(e.target.value)} className="border rounded-xl p-2" />
              <select value={newBranchWarehouseId} onChange={(e) => setNewBranchWarehouseId(e.target.value)} className="border rounded-xl p-2 font-bold">
                <option value="">-- ربط بمستودع --</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <select value={newBranchCashboxId} onChange={(e) => setNewBranchCashboxId(e.target.value)} className="border rounded-xl p-2 font-bold">
                <option value="">-- ربط بخزينة --</option>
                {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={async () => {
                  if (!newBranchName.trim()) return;
                  const item: BranchSettingItem = {
                    id: `BR-${Date.now().toString().slice(-5)}`,
                    name: newBranchName.trim(),
                    code: newBranchCode.trim() || `BR-${branches.length + 1}`,
                    phone: newBranchPhone.trim() || undefined,
                    address: newBranchAddress.trim() || undefined,
                    warehouseId: newBranchWarehouseId || undefined,
                    cashboxId: newBranchCashboxId || undefined,
                    isActive: true,
                  };
                  const next = [...branches, item];
                  setBranches(next);
                  setNewBranchName('');
                  setNewBranchCode('');
                  setNewBranchPhone('');
                  setNewBranchAddress('');
                  await persistExtraSettings({ branches: next }, `تمت إضافة الفرع (${item.name}) بنجاح.`);
                }}
                className="px-5 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black cursor-pointer"
              >
                + إضافة وحفظ الفرع
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 border-b font-bold text-slate-700">
                  <th className="p-3">الكود</th>
                  <th className="p-3">اسم الفرع</th>
                  <th className="p-3">الهاتف والعنوان</th>
                  <th className="p-3">المستودع / الخزينة</th>
                  <th className="p-3 text-center">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {branches.map((br) => (
                  <tr key={br.id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-blue-900">{br.code}</td>
                    <td className="p-3 font-black">{br.name}</td>
                    <td className="p-3 text-slate-600">{br.phone || '-'} | {br.address || '-'}</td>
                    <td className="p-3 text-slate-700">
                      {warehouses.find((w) => w.id === br.warehouseId)?.name || '-'} / {cashboxes.find((c) => c.id === br.cashboxId)?.name || '-'}
                    </td>
                    <td className="p-3 text-center">
                      {!br.isDefault && (
                        <button
                          type="button"
                          onClick={async () => {
                            const next = branches.filter((b) => b.id !== br.id);
                            setBranches(next);
                            await persistExtraSettings({ branches: next }, 'تم حذف الفرع وتحديث الإعدادات.');
                          }}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: Barcode Settings */}
      {activeTab === 'barcode' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 text-xs">
          <h3 className="text-sm font-black text-slate-900 border-b pb-2 flex items-center gap-2">
            <Barcode className="w-4 h-4 text-blue-900" />
            <span>إعدادات طباعة ملصقات الباركود</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-bold mb-1">عرض الملصق (مم):</label>
              <input type="number" min="20" value={barcodeConfig.labelWidthMm} onChange={(e) => setBarcodeConfig({ ...barcodeConfig, labelWidthMm: Number(e.target.value) })} className="w-full border rounded-xl p-2 font-mono font-bold" />
            </div>
            <div>
              <label className="block font-bold mb-1">ارتفاع الملصق (مم):</label>
              <input type="number" min="15" value={barcodeConfig.labelHeightMm} onChange={(e) => setBarcodeConfig({ ...barcodeConfig, labelHeightMm: Number(e.target.value) })} className="w-full border rounded-xl p-2 font-mono font-bold" />
            </div>
            <div>
              <label className="block font-bold mb-1">بادئة الباركود التلقائية:</label>
              <input type="text" value={barcodeConfig.prefix} onChange={(e) => setBarcodeConfig({ ...barcodeConfig, prefix: e.target.value })} className="w-full border rounded-xl p-2 font-mono font-bold" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <label className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={barcodeConfig.showCompanyName} onChange={(e) => setBarcodeConfig({ ...barcodeConfig, showCompanyName: e.target.checked })} />
              <span className="font-bold">إظهار اسم المؤسسة على الملصق</span>
            </label>
            <label className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={barcodeConfig.showProductCode} onChange={(e) => setBarcodeConfig({ ...barcodeConfig, showProductCode: e.target.checked })} />
              <span className="font-bold">إظهار كود الصنف الداخلي</span>
            </label>
            <label className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={barcodeConfig.showPrice} onChange={(e) => setBarcodeConfig({ ...barcodeConfig, showPrice: e.target.checked })} />
              <span className="font-bold">إظهار سعر البيع بالجنيه</span>
            </label>
          </div>
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => persistExtraSettings({ barcodeConfig }, 'تم حفظ إعدادات الباركود بنجاح.')}
              className="px-6 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black cursor-pointer flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>حفظ إعدادات الباركود</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB: Multi-Printers */}
      {activeTab === 'printers' && (
        <div className="space-y-4 text-xs">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-sm font-black text-slate-900 border-b pb-2 flex items-center gap-2">
              <Printer className="w-4 h-4 text-blue-900" />
              <span>إدارة الطابعات المتعددة (الإدارة / الكاشير / الباركود)</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <input type="text" placeholder="اسم الطابعة *" value={newPrinterName} onChange={(e) => setNewPrinterName(e.target.value)} className="border rounded-xl p-2 font-bold" />
              <select value={newPrinterRole} onChange={(e) => setNewPrinterRole(e.target.value as any)} className="border rounded-xl p-2 font-bold">
                <option value="a4">A4 قياسية (فواتير وتقارير)</option>
                <option value="cashier_thermal80">كاشير حرارية 80 مم</option>
                <option value="cashier_thermal58">بلوتوث محمولة 58 مم</option>
                <option value="barcode_label">طابعة ملصقات باركود</option>
              </select>
              <input type="text" placeholder="المنفذ أو IP (مثال: 192.168.1.200)" value={newPrinterPort} onChange={(e) => setNewPrinterPort(e.target.value)} className="border rounded-xl p-2 font-mono" />
              <div className="flex items-center gap-2">
                <input type="number" min="1" max="5" value={newPrinterCopies} onChange={(e) => setNewPrinterCopies(Number(e.target.value))} className="w-20 border rounded-xl p-2 font-mono text-center font-bold" title="عدد النسخ" />
                <button
                  type="button"
                  onClick={async () => {
                    if (!newPrinterName.trim()) return;
                    const item: PrinterSettingItem = {
                      id: `PRT-${Date.now().toString().slice(-5)}`,
                      name: newPrinterName.trim(),
                      role: newPrinterRole,
                      paperWidthMm: newPrinterRole === 'a4' ? 210 : newPrinterRole === 'cashier_thermal80' ? 80 : 58,
                      ipOrPort: newPrinterPort.trim() || 'USB001',
                      copies: Math.max(1, newPrinterCopies),
                      isActive: true,
                    };
                    const next = [...printers, item];
                    setPrinters(next);
                    setNewPrinterName('');
                    await persistExtraSettings({ printers: next }, `تمت إضافة الطابعة (${item.name}) بنجاح.`);
                  }}
                  className="flex-1 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black cursor-pointer"
                >
                  + إضافة طابعة
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="bg-slate-50 border-b font-bold text-slate-700">
                  <th className="p-3">اسم الطابعة</th>
                  <th className="p-3">النوع</th>
                  <th className="p-3">المنفذ / IP</th>
                  <th className="p-3 text-center">النسخ</th>
                  <th className="p-3 text-center">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {printers.map((pr) => (
                  <tr key={pr.id} className="hover:bg-slate-50">
                    <td className="p-3 font-black">{pr.name}</td>
                    <td className="p-3 font-mono text-blue-900">{pr.role} ({pr.paperWidthMm}mm)</td>
                    <td className="p-3 font-mono">{pr.ipOrPort}</td>
                    <td className="p-3 text-center font-mono font-bold">{pr.copies}</td>
                    <td className="p-3 text-center">
                      <button
                        type="button"
                        onClick={async () => {
                          const next = printers.filter((x) => x.id !== pr.id);
                          setPrinters(next);
                          await persistExtraSettings({ printers: next }, 'تم حذف الطابعة من القائمة.');
                        }}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: Invoice Design */}
      {activeTab === 'invoice-design' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 text-xs">
          <h3 className="text-sm font-black text-slate-900 border-b pb-2 flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-900" />
            <span>إعدادات قالب ومحتوى الفاتورة</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={invoiceTemplate.showLogo} onChange={(e) => setInvoiceTemplate({ ...invoiceTemplate, showLogo: e.target.checked })} />
              <span className="font-bold">إظهار شعار أولاد سليم في رأس الفاتورة</span>
            </label>
            <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={invoiceTemplate.showPreviousBalance} onChange={(e) => setInvoiceTemplate({ ...invoiceTemplate, showPreviousBalance: e.target.checked })} />
              <span className="font-bold">إظهار الرصيد السابق للعميل</span>
            </label>
            <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={invoiceTemplate.showRemainingBalance} onChange={(e) => setInvoiceTemplate({ ...invoiceTemplate, showRemainingBalance: e.target.checked })} />
              <span className="font-bold">إظهار الرصيد النهائي المستحق بعد الفاتورة</span>
            </label>
            <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={invoiceTemplate.showSignatureBoxes} onChange={(e) => setInvoiceTemplate({ ...invoiceTemplate, showSignatureBoxes: e.target.checked })} />
              <span className="font-bold">إظهار خانات توقيع المستلم وأمين المخزن</span>
            </label>
          </div>
          <div>
            <label className="block font-bold mb-1">نص تذييل الفاتورة المعتمد:</label>
            <textarea rows={2} value={invoiceTemplate.footerText} onChange={(e) => setInvoiceTemplate({ ...invoiceTemplate, footerText: e.target.value })} className="w-full border rounded-xl p-2.5" />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => persistExtraSettings({ invoiceTemplate }, 'تم حفظ إعدادات قالب الفاتورة بنجاح.')}
              className="px-6 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black cursor-pointer flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>حفظ إعدادات الفاتورة</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB: Mobile Config */}
      {activeTab === 'mobile-config' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 text-xs">
          <h3 className="text-sm font-black text-slate-900 border-b pb-2 flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-emerald-700" />
            <span>إعدادات بوابة الموبايل (تطبيق العملاء وتطبيق المناديب)</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={mobileConfig.enableCustomerApp} onChange={(e) => setMobileConfig({ ...mobileConfig, enableCustomerApp: e.target.checked })} />
              <span className="font-bold">تفعيل استقبال الطلبات من تطبيق العملاء</span>
            </label>
            <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={mobileConfig.enableRepApp} onChange={(e) => setMobileConfig({ ...mobileConfig, enableRepApp: e.target.checked })} />
              <span className="font-bold">تفعيل بوابة المناديب والتحويل بالنصف</span>
            </label>
            <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={mobileConfig.allowCustomerPriceView} onChange={(e) => setMobileConfig({ ...mobileConfig, allowCustomerPriceView: e.target.checked })} />
              <span className="font-bold">إظهار أسعار البيع للعملاء داخل التطبيق</span>
            </label>
            <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={mobileConfig.requireOrderApproval} onChange={(e) => setMobileConfig({ ...mobileConfig, requireOrderApproval: e.target.checked })} />
              <span className="font-bold">اشتراط اعتماد الإدارة قبل تحويل طلب العميل لفاتورة</span>
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => persistExtraSettings({ mobileConfig }, 'تم حفظ إعدادات الموبايل بنجاح.')}
              className="px-6 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black cursor-pointer flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>حفظ إعدادات الموبايل</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB: Online Sync */}
      {activeTab === 'online-sync' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 text-xs">
          <h3 className="text-sm font-black text-slate-900 border-b pb-2 flex items-center gap-2">
            <Wifi className="w-4 h-4 text-teal-700" />
            <span>إعدادات المزامنة الأونلاين والربط المركزي</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={onlineSyncConfig.autoSyncEnabled} onChange={(e) => setOnlineSyncConfig({ ...onlineSyncConfig, autoSyncEnabled: e.target.checked })} />
              <span className="font-bold">تفعيل المزامنة التلقائية الدورية</span>
            </label>
            <div>
              <label className="block font-bold mb-1">فاصل المزامنة (بالثواني):</label>
              <input type="number" min="10" value={onlineSyncConfig.syncIntervalSeconds} onChange={(e) => setOnlineSyncConfig({ ...onlineSyncConfig, syncIntervalSeconds: Number(e.target.value) })} className="w-full border rounded-xl p-2 font-mono font-bold" />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-bold mb-1">رابط السيرفر البعيد / السحابي (اختياري):</label>
              <input type="text" placeholder="http://192.168.1.100:3000" value={onlineSyncConfig.cloudEndpointUrl || ''} onChange={(e) => setOnlineSyncConfig({ ...onlineSyncConfig, cloudEndpointUrl: e.target.value })} className="w-full border rounded-xl p-2 font-mono" />
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('server')}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold cursor-pointer"
            >
              ربط الأجهزة وأوضاع الاتصال (QR / URL)
            </button>
            <button
              type="button"
              onClick={handleTestConnection}
              className="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl font-bold cursor-pointer"
            >
              فحص الاتصال الآن
            </button>
            <button
              type="button"
              onClick={() => persistExtraSettings({ onlineSyncConfig }, 'تم حفظ إعدادات المزامنة بنجاح.')}
              className="px-6 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black cursor-pointer flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>حفظ إعدادات المزامنة</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB: Per-User Keyboard Shortcuts Management */}
      {activeTab === 'shortcuts' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-5 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4">
            <div>
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-purple-700" />
                <span>إعدادات اختصارات لوحة المفاتيح ({currentUser?.fullName})</span>
              </h3>
              <p className="text-[11px] text-slate-500 mt-1">
                تخصيص اختصاراتك الشخصية لكل قسم ووظيفة (تعمل مباشرة دون إعادة تشغيل البرنامج وتدعم لوحة المفاتيح العربية والإنجليزية).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const firstDef = userShortcutCatalog[0] || SHORTCUT_CATALOG[0];
                  setRecorderConflict(null);
                  setRecordingTarget({
                    mode: 'add',
                    actionId: firstDef?.actionId || 'nav:dashboard',
                    label: firstDef?.label || 'اختصار مخصص',
                    category: firstDef?.category || 'عام',
                    keyCombo: '',
                  });
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-bold cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة / تخصيص اختصار</span>
              </button>
              <button
                type="button"
                onClick={() => setShowResetShortcutsConfirm(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl font-bold cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>استعادة الافتراضي</span>
              </button>
            </div>
          </div>

          {shortcutFeedback && (
            <div
              className={`p-3 rounded-xl border font-bold flex items-center justify-between ${
                shortcutFeedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              <span>{shortcutFeedback.text}</span>
              <button type="button" onClick={() => setShortcutFeedback(null)} className="underline text-[11px] cursor-pointer">
                إغلاق
              </button>
            </div>
          )}

          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            <input
              type="text"
              placeholder="ابحث عن وظيفة أو مفتاح اختصار (مثال: الطباعة، Ctrl+S)..."
              value={shortcutSearch}
              onChange={(e) => setShortcutSearch(e.target.value)}
              className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-300 rounded-xl font-bold outline-hidden focus:bg-white focus:border-blue-700"
            />
          </div>

          {(['التنقل', 'المبيعات والمشتريات', 'المخزون', 'العملاء والمالية', 'عام'] as ShortcutCategory[]).map((cat) => {
            const catItems = userShortcuts.filter(
              (sc) =>
                sc.category === cat &&
                (!shortcutSearch.trim() ||
                  sc.label.toLowerCase().includes(shortcutSearch.toLowerCase()) ||
                  (sc.keyCombo || '').toLowerCase().includes(shortcutSearch.toLowerCase()))
            );
            if (catItems.length === 0) return null;
            return (
              <div key={cat} className="space-y-2">
                <h4 className="font-black text-blue-950 text-xs bg-slate-100 px-3 py-1.5 rounded-lg inline-block">
                  {cat} ({catItems.length})
                </h4>
                <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-100">
                  {catItems.map((sc) => (
                    <div
                      key={sc.actionId}
                      className={`p-3 flex flex-wrap items-center justify-between gap-3 ${
                        sc.enabled === false ? 'bg-slate-50/70 opacity-70' : 'bg-white hover:bg-slate-50/70'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-900">{sc.label}</div>
                        <div className="text-[10px] font-mono text-slate-400">{sc.actionId}</div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {sc.keyCombo ? (
                          <kbd
                            dir="ltr"
                            className={`px-3 py-1.5 rounded-xl font-mono font-black text-xs border min-w-20 text-center ${
                              sc.enabled !== false
                                ? 'bg-blue-50 text-blue-950 border-blue-300'
                                : 'bg-slate-100 text-slate-400 border-slate-200 line-through'
                            }`}
                          >
                            {sc.keyCombo}
                          </kbd>
                        ) : (
                          <span className="px-3 py-1.5 rounded-xl text-[11px] bg-slate-100 text-slate-500 border border-slate-200">
                            غير معيّن
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setRecorderConflict(null);
                            setRecordingTarget({
                              mode: 'edit',
                              actionId: sc.actionId,
                              label: sc.label,
                              category: sc.category,
                              keyCombo: sc.keyCombo,
                            });
                          }}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-blue-100 text-slate-800 hover:text-blue-900 rounded-xl font-bold cursor-pointer"
                        >
                          تعديل المفتاح
                        </button>

                        <button
                          type="button"
                          disabled={isSavingUserShortcuts}
                          onClick={async () => {
                            const next = userShortcuts.map((item) =>
                              item.actionId === sc.actionId ? { ...item, enabled: item.enabled === false } : item
                            );
                            const res = await saveShortcuts(next);
                            if (!res.success) {
                              setShortcutFeedback({ type: 'error', text: res.error || 'تعذر تحديث الحالة' });
                            } else {
                              setShortcutFeedback({
                                type: 'success',
                                text: `تم ${sc.enabled === false ? 'تفعيل' : 'تعطيل'} اختصار (${sc.label}).`,
                              });
                            }
                          }}
                          title={sc.enabled === false ? 'تفعيل الاختصار' : 'تعطيل الاختصار'}
                          className={`p-1.5 rounded-xl border cursor-pointer ${
                            sc.enabled !== false
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-500 border-slate-300 hover:bg-slate-200'
                          }`}
                        >
                          <Power className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          disabled={isSavingUserShortcuts}
                          onClick={async () => {
                            const next = userShortcuts.map((item) =>
                              item.actionId === sc.actionId ? { ...item, keyCombo: '', enabled: false } : item
                            );
                            const res = await saveShortcuts(next);
                            if (res.success) {
                              setShortcutFeedback({ type: 'success', text: `تم حذف مفتاح الاختصار لوظيفة (${sc.label}).` });
                            }
                          }}
                          title="حذف المفتاح"
                          className="p-1.5 rounded-xl text-red-500 hover:bg-red-50 border border-transparent hover:border-red-200 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Key Recorder Modal */}
          <Modal
            isOpen={!!recordingTarget}
            onClose={() => setRecordingTarget(null)}
            title={recordingTarget?.mode === 'add' ? 'إضافة / تخصيص اختصار لوحة مفاتيح' : `تغيير اختصار: ${recordingTarget?.label || ''}`}
            maxWidth="md"
          >
            {recordingTarget && (
              <div
                data-shortcut-recorder="true"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setRecordingTarget(null);
                    return;
                  }
                  const combo = eventToKeyCombo(e.nativeEvent);
                  if (!combo) return;
                  e.preventDefault();
                  e.stopPropagation();

                  if (isReservedSystemCombo(combo)) {
                    setRecorderConflict(`الاختصار (${combo}) محجوز لعمليات النظام الأساسية (نسخ/لصق/تحديد). يرجى اختيار مفتاح آخر.`);
                    setRecordingTarget({ ...recordingTarget, keyCombo: combo });
                    return;
                  }
                  if (/^Shift\+[A-Z0-9]$/.test(combo)) {
                    setRecorderConflict(`الاختصار (${combo}) يتعارض مع الكتابة بالحروف الكبيرة داخل الحقول؛ أضف Ctrl أو Alt.`);
                    setRecordingTarget({ ...recordingTarget, keyCombo: combo });
                    return;
                  }
                  const conflict = findConflict(combo, recordingTarget.actionId, userShortcuts);
                  if (conflict) {
                    setRecorderConflict(`تحذير: الاختصار (${combo}) مستخدم بالفعل في الوظيفة: "${conflict.label}"`);
                  } else {
                    setRecorderConflict(null);
                  }
                  setRecordingTarget({ ...recordingTarget, keyCombo: combo });
                }}
                className="space-y-4 text-xs outline-hidden"
              >
                {recordingTarget.mode === 'add' && (
                  <div>
                    <label className="block font-bold mb-1">اختر الوظيفة المراد تخصيص اختصار لها:</label>
                    <select
                      value={recordingTarget.actionId}
                      onChange={(e) => {
                        const def = userShortcutCatalog.find((d) => d.actionId === e.target.value);
                        const cur = userShortcuts.find((s) => s.actionId === e.target.value);
                        setRecorderConflict(null);
                        setRecordingTarget({
                          ...recordingTarget,
                          actionId: e.target.value,
                          label: def?.label || cur?.label || e.target.value,
                          category: def?.category || cur?.category || 'عام',
                          keyCombo: cur?.keyCombo || '',
                        });
                      }}
                      className="w-full border rounded-xl p-2.5 font-bold"
                    >
                      {userShortcutCatalog.map((def) => (
                        <option key={def.actionId} value={def.actionId}>
                          {def.label} ({def.category})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="p-5 rounded-2xl bg-blue-50/70 border-2 border-dashed border-blue-300 text-center space-y-2">
                  <p className="font-bold text-slate-700">
                    اضغط الآن على مجموعة المفاتيح المطلوبة (مثل Ctrl+P أو Alt+S أو F2 أو Ctrl+Shift+N)
                  </p>
                  <div className="py-2">
                    <kbd
                      dir="ltr"
                      className="inline-block px-5 py-2.5 rounded-xl bg-white border border-blue-300 text-blue-950 font-mono font-black text-base shadow-xs min-w-36"
                    >
                      {recordingTarget.keyCombo || 'في انتظار الضغط...'}
                    </kbd>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    ملاحظة: يتم حفظ الاختصار اعتماداً على المفتاح الفيزيائي ليعمل مع لوحة المفاتيح العربية والإنجليزية على السواء.
                  </p>
                </div>

                {/* Manual Modifier + Key Builder */}
                {(() => {
                  const parts = normalizeComboString(recordingTarget.keyCombo).split('+').filter(Boolean);
                  const hasCtrl = parts.includes('Ctrl');
                  const hasAlt = parts.includes('Alt');
                  const hasShift = parts.includes('Shift');
                  const baseKey = parts.find((p) => !['Ctrl', 'Alt', 'Shift'].includes(p)) || '';
                  const updateManualCombo = (nextCtrl: boolean, nextAlt: boolean, nextShift: boolean, nextKey: string) => {
                    if (!nextKey) {
                      setRecorderConflict(null);
                      setRecordingTarget({ ...recordingTarget, keyCombo: '' });
                      return;
                    }
                    const nextParts: string[] = [];
                    if (nextCtrl) nextParts.push('Ctrl');
                    if (nextAlt) nextParts.push('Alt');
                    if (nextShift) nextParts.push('Shift');
                    nextParts.push(nextKey);
                    const combo = normalizeComboString(nextParts.join('+'));
                    if (isReservedSystemCombo(combo)) {
                      setRecorderConflict(`الاختصار (${combo}) محجوز لعمليات النظام الأساسية (نسخ/لصق/تحديد). يرجى اختيار مفتاح آخر.`);
                    } else if (/^Shift\+[A-Z0-9]$/.test(combo)) {
                      setRecorderConflict(`الاختصار (${combo}) يتعارض مع الكتابة بالحروف الكبيرة داخل الحقول؛ أضف Ctrl أو Alt.`);
                    } else if (/^[A-Z0-9]$/.test(combo)) {
                      setRecorderConflict(`الاختصار (${combo}) بدون مفتاح تحكم يتعارض مع الكتابة؛ اختر Ctrl أو Alt أو مفتاح وظيفة F1-F12.`);
                    } else {
                      const conflict = findConflict(combo, recordingTarget.actionId, userShortcuts);
                      setRecorderConflict(
                        conflict ? `تحذير: الاختصار (${combo}) مستخدم بالفعل في الوظيفة: "${conflict.label}"` : null
                      );
                    }
                    setRecordingTarget({ ...recordingTarget, keyCombo: combo });
                  };
                  const keyOptions = [
                    'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
                    'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
                    '0','1','2','3','4','5','6','7','8','9',
                    'Enter','Space','Insert','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
                  ];
                  return (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                      <span className="block font-bold text-slate-700 text-[11px]">
                        أو اختر مفاتيح التحكم والمفتاح يدوياً:
                      </span>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-1.5 font-mono font-bold text-slate-800 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={hasCtrl}
                            onChange={(e) => updateManualCombo(e.target.checked, hasAlt, hasShift, baseKey)}
                            className="w-4 h-4 rounded text-blue-900"
                          />
                          <span>Ctrl</span>
                        </label>
                        <label className="flex items-center gap-1.5 font-mono font-bold text-slate-800 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={hasAlt}
                            onChange={(e) => updateManualCombo(hasCtrl, e.target.checked, hasShift, baseKey)}
                            className="w-4 h-4 rounded text-blue-900"
                          />
                          <span>Alt</span>
                        </label>
                        <label className="flex items-center gap-1.5 font-mono font-bold text-slate-800 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={hasShift}
                            onChange={(e) => updateManualCombo(hasCtrl, hasAlt, e.target.checked, baseKey)}
                            className="w-4 h-4 rounded text-blue-900"
                          />
                          <span>Shift</span>
                        </label>
                        <select
                          dir="ltr"
                          value={baseKey}
                          onChange={(e) => updateManualCombo(hasCtrl, hasAlt, hasShift, e.target.value)}
                          className="flex-1 min-w-28 bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 font-mono font-bold"
                        >
                          <option value="">-- اختر المفتاح --</option>
                          {keyOptions.map((k) => (
                            <option key={k} value={k}>{k}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })()}

                {recorderConflict && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{recorderConflict}</span>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <button
                    type="button"
                    onClick={() => setRecordingTarget(null)}
                    className="px-4 py-2 border rounded-xl font-bold cursor-pointer"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    disabled={isSavingUserShortcuts || !recordingTarget.keyCombo || Boolean(recorderConflict)}
                    onClick={async () => {
                      const norm = normalizeComboString(recordingTarget.keyCombo);
                      const nextList: UserShortcutItem[] = userShortcuts.some((s) => s.actionId === recordingTarget.actionId)
                        ? userShortcuts.map((s) =>
                            s.actionId === recordingTarget.actionId ? { ...s, keyCombo: norm, enabled: true } : s
                          )
                        : [
                            ...userShortcuts,
                            {
                              id: `SC-${recordingTarget.actionId}`,
                              actionId: recordingTarget.actionId,
                              label: recordingTarget.label,
                              category: recordingTarget.category,
                              keyCombo: norm,
                              enabled: true,
                            },
                          ];
                      const res = await saveShortcuts(nextList);
                      if (!res.success) {
                        setRecorderConflict(res.error || 'تعذر حفظ الاختصار');
                      } else {
                        setRecordingTarget(null);
                        setShortcutFeedback({
                          type: 'success',
                          text: `تم حفظ وتفعيل الاختصار (${norm}) للوظيفة (${recordingTarget.label}) فوراً.`,
                        });
                      }
                    }}
                    className="px-5 py-2 bg-blue-900 text-white rounded-xl font-black disabled:opacity-50 cursor-pointer"
                  >
                    {isSavingUserShortcuts ? 'جاري الحفظ...' : 'حفظ الاختصار وتفعيله'}
                  </button>
                </div>
              </div>
            )}
          </Modal>

          <ConfirmDialog
            isOpen={showResetShortcutsConfirm}
            onClose={() => setShowResetShortcutsConfirm(false)}
            onConfirm={async () => {
              const res = await resetToDefaults();
              setShowResetShortcutsConfirm(false);
              if (res.success) {
                setShortcutFeedback({ type: 'success', text: 'تمت استعادة كافة الاختصارات الافتراضية بنجاح.' });
              } else {
                setShortcutFeedback({ type: 'error', text: res.error || 'تعذر استعادة الافتراضي' });
              }
            }}
            title="استعادة الاختصارات الافتراضية"
            message="هل تريد استعادة جميع اختصارات لوحة المفاتيح الخاصة بحسابك إلى الإعدادات الافتراضية للنظام؟"
            confirmLabel="استعادة الافتراضي"
            variant="warning"
            isLoading={isSavingUserShortcuts}
          />
        </div>
      )}

      {/* TAB: Services */}
      {activeTab === 'services' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 text-xs">
          <h3 className="text-sm font-black text-slate-900 border-b pb-2 flex items-center gap-2">
            <Wrench className="w-4 h-4 text-amber-700" />
            <span>خدمات النظام والأتمتة</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={servicesConfig.enableBarcodeScanner} onChange={(e) => setServicesConfig({ ...servicesConfig, enableBarcodeScanner: e.target.checked })} />
              <span className="font-bold">دعم قارئ الباركود USB / اللاسلكي</span>
            </label>
            <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={servicesConfig.enableAutoBackup} onChange={(e) => setServicesConfig({ ...servicesConfig, enableAutoBackup: e.target.checked })} />
              <span className="font-bold">إنشاء نسخ احتياطي آلي قبل التغييرات الكبرى</span>
            </label>
            <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border cursor-pointer">
              <input type="checkbox" checked={servicesConfig.enableWhatsAppAlerts} onChange={(e) => setServicesConfig({ ...servicesConfig, enableWhatsAppAlerts: e.target.checked })} />
              <span className="font-bold">تجهيز رسائل وإشعارات واتساب للعملاء</span>
            </label>
          </div>
          <div>
            <label className="block font-bold mb-1">رقم واتساب المؤسسة المعتمد:</label>
            <input type="text" value={servicesConfig.whatsappNumber || ''} onChange={(e) => setServicesConfig({ ...servicesConfig, whatsappNumber: e.target.value })} className="w-full max-w-sm border rounded-xl p-2 font-mono font-bold" />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => persistExtraSettings({ servicesConfig }, 'تم حفظ إعدادات الخدمات بنجاح.')}
              className="px-6 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black cursor-pointer flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>حفظ الخدمات</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

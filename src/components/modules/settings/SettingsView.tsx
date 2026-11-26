import React, { useState, useMemo, useEffect } from 'react';
import {
  Settings, Save, Download, Upload, Database, RefreshCw,
  Printer, Building2, ShieldCheck, Check, AlertCircle, Trash2, RotateCcw,
  Server, Wifi, WifiOff, Activity, Monitor, Smartphone, FileSpreadsheet,
  Eye, ArrowLeftRight, CheckCircle2, ShoppingCart, User, Layers,
  Barcode, FileText, Keyboard, Wrench, GitBranch, Plus, Search, Power,
  Globe, Cloud, Lock, Copy, Radio, Users, Sun, Moon, Languages
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { useAuth } from '../../../context/AuthContext';
import { usePreferences } from '../../../context/PreferencesContext';
import { formatLocaleDateTime, formatLocaleNumber } from '../../../i18n/translator';
import {
  useShortcuts, SHORTCUT_CATALOG, eventToKeyCombo, isReservedSystemCombo, normalizeComboString
} from '../../../context/ShortcutsContext';
import {
  apiRequest,
  getConfiguredApiBaseUrl,
  getDefaultConnectionProfiles,
  getStoredConnectionProfiles,
  getConnectionModeLabel,
  resolveModeEndpointUrl,
  validateConnectionUrl,
  setConfiguredApiBaseUrl,
} from '../../../services/api';
import { isMobileAppPlatform, isNativeCapacitor } from '../../../services/native';
import { ConfirmDialog } from '../../common/ConfirmDialog';
import { Modal } from '../../common/Modal';
import { UnifiedDataTable } from '../../common/UnifiedDataTable';
import { PairingAndDevicesPanel } from './PairingAndDevicesPanel';
import { DiagnosticLogsPanel } from './DiagnosticLogsPanel';
import {
  ServerConnectionSettings, ProductImportCandidate, ConnectionMode, ConnectionProfilesConfig,
  BranchSettingItem, PrinterSettingItem, ExtraSettingsConfig, UserShortcutItem, ShortcutCategory,
  TunnelRuntimeStatus, PairedDevicesSummary,
} from '../../../types';

export type SettingsTabKey =
  | 'account'
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
  | 'services'
  | 'diagnostics';

interface SettingsViewProps {
  initialTab?: SettingsTabKey;
}

const PERMISSION_LABELS: Record<string, { ar: string; en: string }> = {
  canView: { ar: 'العرض والقراءة', en: 'View & Read' },
  canAdd: { ar: 'الإضافة والإنشاء', en: 'Add & Create' },
  canEdit: { ar: 'التعديل', en: 'Edit' },
  canDelete: { ar: 'الحذف والإلغاء', en: 'Delete & Cancel' },
  canPrint: { ar: 'الطباعة', en: 'Print' },
  canExport: { ar: 'تصدير Excel', en: 'Export Excel' },
  canViewReports: { ar: 'التقارير المالية', en: 'Financial Reports' },
  canManageSales: { ar: 'إدارة المبيعات', en: 'Manage Sales' },
  canManagePurchases: { ar: 'إدارة المشتريات الكاملة', en: 'Full Purchases Management' },
  canCreatePurchase: { ar: 'إنشاء فواتير شراء مسودة', en: 'Create Draft Purchase Invoices' },
  canManageInventory: { ar: 'إدارة المخزون والأصناف', en: 'Inventory & Products Management' },
  canManageWarehouses: { ar: 'إدارة المستودعات', en: 'Warehouses Management' },
  canManageCashboxes: { ar: 'إدارة الخزائن', en: 'Cashboxes Management' },
  canManageAccounts: { ar: 'إدارة الحسابات', en: 'Accounts Management' },
  canManageTransfers: { ar: 'التحويل بالنصف', en: 'Half-Transfer System' },
  canManageReps: { ar: 'إدارة المندوبين', en: 'Representatives Management' },
  canApprove: { ar: 'اعتماد المستندات', en: 'Approve Documents' },
  canReviewRepInvoices: { ar: 'مراجعة فواتير المناديب', en: 'Review Rep Invoices' },
  canSend: { ar: 'إرسال المزامنة', en: 'Send Sync' },
  canReceive: { ar: 'استلام المزامنة', en: 'Receive Sync' },
  canManageEmployees: { ar: 'شؤون الموظفين', en: 'HR & Employees' },
  canManageUsers: { ar: 'إدارة المستخدمين', en: 'User Management' },
  canManageSettings: { ar: 'إعدادات النظام', en: 'System Settings' },
  canCreateStockCount: { ar: 'إنشاء جرد مخزن', en: 'Create Stock Count' },
  canApproveStockCount: { ar: 'اعتماد جرد المخزن', en: 'Approve Stock Count' },
  canCreateStockTransfer: { ar: 'أوامر تحويل الأصناف', en: 'Create Stock Transfers' },
  canApproveStockTransfer: { ar: 'اعتماد تحويل الأصناف', en: 'Approve Stock Transfers' },
  canExecuteStockTransfer: { ar: 'تنفيذ تحويل الأصناف', en: 'Execute Stock Transfers' },
  canViewDeletedInvoices: { ar: 'الفواتير المحذوفة', en: 'View Deleted Invoices' },
};

export const SettingsView: React.FC<SettingsViewProps> = ({ initialTab = 'general' }) => {
  const {
    settings, updateSettings, exportBackup, importBackup,
    serverSettings, updateServerSettings, testServerConnection,
    products, addProduct, deleteImportedProducts, warehouses, cashboxes, users, migrationLogs, runMigration, rollbackMigration,
  } = useData();
  const { hasPermission, currentUser, updatePassword, logout, savedAccounts, setIsAccountSwitcherOpen } = useAuth();
  const { themePreference, setThemePreference, language, setLanguage, dir, t } = usePreferences();
  const {
    shortcuts: userShortcuts,
    catalog: userShortcutCatalog,
    isSaving: isSavingUserShortcuts,
    findConflict,
    saveShortcuts,
    resetToDefaults,
  } = useShortcuts();

  const isMobilePlatform = isMobileAppPlatform();
  const canManageSettings = currentUser?.role === 'admin' || hasPermission('canManageSettings');
  const canManageInventory = currentUser?.role === 'admin' || hasPermission('canManageInventory');
  const resolvedInitialTab: SettingsTabKey =
    initialTab === 'account'
      ? 'account'
      : initialTab === 'shortcuts'
      ? isMobilePlatform
        ? 'account'
        : 'shortcuts'
      : initialTab === 'abu-selim' && canManageInventory
      ? 'abu-selim'
      : canManageSettings
      ? initialTab
      : canManageInventory && initialTab === 'abu-selim'
      ? 'abu-selim'
      : 'account';

  const [activeTab, setActiveTab] = useState<SettingsTabKey>(resolvedInitialTab);
  const [accountCurrentPassword, setAccountCurrentPassword] = useState('');
  const [accountNewPassword, setAccountNewPassword] = useState('');
  const [accountConfirmPassword, setAccountConfirmPassword] = useState('');
  const [isUpdatingAccountPassword, setIsUpdatingAccountPassword] = useState(false);
  const [accountPasswordFeedback, setAccountPasswordFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
  const [savedNotice, setSavedNotice] = useState<string>(() => t('تم حفظ الإعدادات بنجاح', 'Settings saved successfully'));
  const [importError, setImportError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);

  // Extra Control Panel Settings State
  const extra: ExtraSettingsConfig = settings.extraSettings || {};
  const [branches, setBranches] = useState<BranchSettingItem[]>(extra.branches || [
    { id: 'BR-MAIN', name: t('الفرع الرئيسي - أولاد سليم', 'Main Branch - Awlad Selim'), code: 'MAIN', warehouseId: warehouses[0]?.id, cashboxId: cashboxes[0]?.id, isDefault: true, isActive: true },
  ]);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchCode, setNewBranchCode] = useState('');
  const [newBranchNumber, setNewBranchNumber] = useState('');
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
    { id: 'PRT-A4', name: t('طابعة الإدارة الرئيسية A4', 'Main Admin Printer A4'), role: 'a4', paperWidthMm: 210, ipOrPort: 'USB001', copies: 1, isDefault: true, isActive: true },
    { id: 'PRT-POS80', name: t('طابعة كاشير حرارية 80مم', 'Thermal Cashier Printer 80mm'), role: 'cashier_thermal80', paperWidthMm: 80, ipOrPort: '192.168.1.201', copies: 1, isDefault: false, isActive: true },
  ]);
  const [newPrinterName, setNewPrinterName] = useState('');
  const [newPrinterRole, setNewPrinterRole] = useState<PrinterSettingItem['role']>('cashier_thermal80');
  const [newPrinterPort, setNewPrinterPort] = useState('');
  const [newPrinterCopies, setNewPrinterCopies] = useState<number | ''>('');

  const [invoiceTemplate, setInvoiceTemplate] = useState(extra.invoiceTemplate || {
    showLogo: true,
    showPreviousBalance: true,
    showRemainingBalance: true,
    showSignatureBoxes: true,
    footerText: settings.invoiceNotes || t('شكراً لتعاملكم مع مؤسسة أولاد سليم', 'Thank you for doing business with Awlad Selim'),
  });

  const [mobileConfig, setMobileConfig] = useState(extra.mobileConfig || {
    enableCustomerApp: true,
    enableRepApp: true,
    allowCustomerPriceView: true,
    requireOrderApproval: true,
  });

  const [onlineSyncConfig, setOnlineSyncConfig] = useState({
    autoSyncEnabled: true,
    syncIntervalSeconds: 30,
    mandatorySendEnabled: true,
    mandatorySendIntervalMinutes: 15,
    cloudEndpointUrl: serverSettings?.apiBaseUrl || '',
    ...(extra.onlineSyncConfig || {}),
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
      if (settings.extraSettings.onlineSyncConfig) {
        setOnlineSyncConfig((prev) => ({
          ...prev,
          mandatorySendEnabled: true,
          mandatorySendIntervalMinutes: 15,
          ...settings.extraSettings!.onlineSyncConfig,
        }));
      }
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

  // Server & Connection Settings Form
  const initialProfiles: ConnectionProfilesConfig =
    serverSettings?.profiles ||
    settings.extraSettings?.connectionConfig ||
    getStoredConnectionProfiles();

  const [serverForm, setServerForm] = useState<ServerConnectionSettings>({
    serverIp: initialProfiles.localNetwork?.ip || serverSettings?.serverIp || '192.168.1.100',
    hostname: initialProfiles.localNetwork?.hostname || serverSettings?.hostname || 'awlad-selim-server',
    port: initialProfiles.localNetwork?.port || serverSettings?.port || 3000,
    apiBaseUrl: serverSettings?.apiBaseUrl || 'http://192.168.1.100:3000',
    connectionType: initialProfiles.activeMode || serverSettings?.connectionType || 'local_network',
    activeMode: initialProfiles.activeMode || 'local_network',
    profiles: initialProfiles,
    serverStatus: serverSettings?.serverStatus || 'online',
    databaseStatus: serverSettings?.databaseStatus || 'connected',
    latencyMs: serverSettings?.latencyMs || 12,
    syncStatus: serverSettings?.syncStatus || 'connected',
    lastSuccessfulConnection: serverSettings?.lastSuccessfulConnection || new Date().toISOString(),
  });
  const [connProfiles, setConnProfiles] = useState<ConnectionProfilesConfig>(initialProfiles);
  const [applyActiveToThisDevice, setApplyActiveToThisDevice] = useState<boolean>(() => isNativeCapacitor());
  const [serverInfo, setServerInfo] = useState<{
    hostname?: string;
    port?: number;
    lanIps?: string[];
    lanUrls?: Array<{ ip: string; url: string }>;
    dataDir?: string;
    isElectron?: boolean;
    databaseMode?: string;
    postgresStatus?: string;
    protocol?: string;
    httpsActive?: boolean;
    tunnelStatus?: TunnelRuntimeStatus;
    devicesSummary?: PairedDevicesSummary;
    appLinksConfigured?: { android: boolean; ios: boolean };
  } | null>(null);
  const [isLoadingServerInfo, setIsLoadingServerInfo] = useState(false);
  const [isPushingUpdate, setIsPushingUpdate] = useState(false);
  const [isTestingServer, setIsTestingServer] = useState(false);
  const [testingModeKey, setTestingModeKey] = useState<ConnectionMode | 'active' | null>(null);
  const [serverTestResult, setServerTestResult] = useState<{
    success: boolean;
    latencyMs: number;
    message: string;
    testedUrl?: string;
    httpsActive?: boolean;
    modeLabel?: string;
  } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSavingServer, setIsSavingServer] = useState(false);

  const handlePushConfigUpdate = async () => {
    setIsPushingUpdate(true);
    setServerError(null);
    try {
      const res = await apiRequest<{ ok: boolean; connectionConfig: ConnectionProfilesConfig }>(
        '/api/admin/connection/push-update',
        { method: 'POST' }
      );
      if (res.connectionConfig) {
        setConnProfiles(res.connectionConfig);
      }
      await loadLiveServerInfo();
      showSavedBanner(
        t(
          `تم تعميم تحديث عنوان الاتصال (الإصدار v${res.connectionConfig?.configVersion || (connProfiles.configVersion || 1) + 1}) لتسحبه جميع الأجهزة تلقائياً عند الاتصال`,
          `Connection profile update (v${res.connectionConfig?.configVersion || (connProfiles.configVersion || 1) + 1}) broadcast to sync across all devices automatically.`
        )
      );
    } catch (err: any) {
      setServerError(err?.message || t('تعذر تعميم التحديث', 'Failed to push connection update'));
    } finally {
      setIsPushingUpdate(false);
    }
  };

  const loadLiveServerInfo = async () => {
    setIsLoadingServerInfo(true);
    try {
      const info = await apiRequest<any>('/api/admin/server-info');
      if (info?.ok) {
        setServerInfo(info);
        const detectedTunnel = String(
          info.connectionConfig?.freeRemote?.tunnelUrl ||
            (info.tunnelStatus?.status === 'online' ? info.tunnelStatus?.tunnelUrl : '') ||
            ''
        ).trim();
        if (detectedTunnel) {
          setConnProfiles((prev) =>
            !prev.freeRemote?.tunnelUrl && prev.freeRemote?.autoDetect !== false
              ? {
                  ...prev,
                  freeRemote: { ...prev.freeRemote, tunnelUrl: detectedTunnel },
                }
              : prev
          );
        }
      }
    } catch {
      // ignore if offline
    } finally {
      setIsLoadingServerInfo(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'server') {
      loadLiveServerInfo();
    }
  }, [activeTab]);

  useEffect(() => {
    const latestProfiles =
      settings.extraSettings?.connectionConfig || serverSettings?.profiles;
    if (latestProfiles) {
      setConnProfiles((prev) => ({
        ...getDefaultConnectionProfiles(),
        ...prev,
        ...latestProfiles,
        localNetwork: {
          ...getDefaultConnectionProfiles().localNetwork,
          ...(latestProfiles.localNetwork || {}),
        },
        freeRemote: {
          ...getDefaultConnectionProfiles().freeRemote,
          ...(latestProfiles.freeRemote || {}),
        },
        proRemote: {
          ...getDefaultConnectionProfiles().proRemote,
          ...(latestProfiles.proRemote || {}),
        },
        cloudVps: {
          ...getDefaultConnectionProfiles().cloudVps,
          ...(latestProfiles.cloudVps || {}),
        },
      }));
    }
  }, [settings.extraSettings?.connectionConfig, serverSettings?.profiles]);

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
          fileName: p.sourceFileName || (batchId === 'UNBATCHED' ? t('دفعة استيراد سابقة', 'Previous Import Batch') : batchId),
          count: 1,
        });
      }
    });
    return Array.from(map.values());
  }, [importedProductsList, t]);

  // 1. General Settings Handlers
  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings(formData);
    showSavedBanner(t('تم حفظ إعدادات المنشأة والطباعة بنجاح', 'Company and printing settings saved successfully'));
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
        setRestoreSuccess(t('تمت استعادة قاعدة البيانات بنجاح! جاري تحديث البيانات...', 'Database restored successfully! Refreshing data...'));
        setTimeout(() => window.location.reload(), 900);
      } else {
        setImportError(res.error || t('فشلت استعادة النسخة الاحتياطية', 'Failed to restore backup'));
      }
    };
    reader.readAsText(file);
  };

  // 2. Server & Connection Settings Handlers
  const handleTestConnection = async (targetMode?: ConnectionMode) => {
    const modeToTest = targetMode || null;
    setTestingModeKey(modeToTest || 'active');
    setIsTestingServer(true);
    setServerTestResult(null);
    setServerError(null);

    let urlToTest: string | undefined;
    if (modeToTest) {
      const candidate = resolveModeEndpointUrl(modeToTest, connProfiles);
      const check = validateConnectionUrl(
        modeToTest,
        candidate,
        connProfiles.enforceHttpsForRemote !== false
      );
      if (!check.valid) {
        setIsTestingServer(false);
        setTestingModeKey(null);
        setServerTestResult({
          success: false,
          latencyMs: 0,
          testedUrl: candidate,
          modeLabel: getConnectionModeLabel(modeToTest),
          message: check.error || t('عنوان السيرفر غير صالح للاختبار', 'Server URL is invalid for testing'),
        });
        return;
      }
      urlToTest = check.normalizedUrl;
    }

    const res = await testServerConnection(urlToTest);
    setIsTestingServer(false);
    setTestingModeKey(null);

    if (res.success) {
      const displayTarget = urlToTest || getConfiguredApiBaseUrl() || t('Same-Origin (السيرفر الحالي)', 'Same-Origin (Current Server)');
      setServerTestResult({
        success: true,
        latencyMs: res.latencyMs,
        testedUrl: displayTarget,
        httpsActive: res.httpsActive,
        modeLabel: modeToTest ? getConnectionModeLabel(modeToTest) : getConnectionModeLabel(connProfiles.activeMode),
        message: t(
          `تم الاتصال بنجاح (${displayTarget}) — زمن الاستجابة: ${res.latencyMs} مللي ثانية${res.httpsActive ? ' • اتصال HTTPS مشفر' : ''}`,
          `Connected successfully (${displayTarget}) — Latency: ${res.latencyMs} ms${res.httpsActive ? ' • Encrypted HTTPS' : ''}`
        ),
      });
      setServerForm((prev) => ({
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
        testedUrl: urlToTest || getConfiguredApiBaseUrl() || 'Same-Origin',
        modeLabel: modeToTest ? getConnectionModeLabel(modeToTest) : getConnectionModeLabel(connProfiles.activeMode),
        message: res.error || t('تعذر الاتصال بعنوان السيرفر', 'Failed to connect to server URL'),
      });
    }
  };

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setIsSavingServer(true);

    const enforceHttps = connProfiles.enforceHttpsForRemote !== false;
    // Validate any non-empty remote URLs + required active mode URL
    const modesToValidate: ConnectionMode[] = ['local_network', 'free_remote', 'pro_remote', 'cloud_vps'];
    const cleanedProfiles: ConnectionProfilesConfig = {
      ...connProfiles,
      localNetwork: {
        ip: (connProfiles.localNetwork.ip || '').trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0] || '192.168.1.100',
        port: Number(connProfiles.localNetwork.port || 3000) || 3000,
        hostname: (connProfiles.localNetwork.hostname || 'awlad-selim-server').trim(),
      },
      freeRemote: {
        tunnelUrl: (connProfiles.freeRemote.tunnelUrl || '').trim(),
        autoDetect: connProfiles.freeRemote.autoDetect !== false,
      },
      proRemote: {
        domainUrl: (connProfiles.proRemote.domainUrl || '').trim(),
        provider: connProfiles.proRemote.provider || 'cloudflare_named_tunnel',
      },
      cloudVps: {
        vpsUrl: (connProfiles.cloudVps.vpsUrl || '').trim(),
        notes: (connProfiles.cloudVps.notes || '').trim(),
      },
    };

    for (const m of modesToValidate) {
      const rawVal =
        m === 'local_network'
          ? resolveModeEndpointUrl('local_network', cleanedProfiles)
          : m === 'free_remote'
          ? cleanedProfiles.freeRemote.tunnelUrl
          : m === 'pro_remote'
          ? cleanedProfiles.proRemote.domainUrl
          : cleanedProfiles.cloudVps.vpsUrl;

      if (rawVal || m === cleanedProfiles.activeMode) {
        const check = validateConnectionUrl(m, rawVal, enforceHttps);
        if (!check.valid) {
          setIsSavingServer(false);
          setServerError(`${getConnectionModeLabel(m)}: ${check.error}`);
          return;
        }
        if (m === 'free_remote') cleanedProfiles.freeRemote.tunnelUrl = check.normalizedUrl;
        if (m === 'pro_remote') cleanedProfiles.proRemote.domainUrl = check.normalizedUrl;
        if (m === 'cloud_vps') cleanedProfiles.cloudVps.vpsUrl = check.normalizedUrl;
      }
    }

    const activeEndpointUrl = resolveModeEndpointUrl(cleanedProfiles.activeMode, cleanedProfiles);
    const localUrl = resolveModeEndpointUrl('local_network', cleanedProfiles);

    const result = await updateServerSettings(
      {
        ...serverForm,
        serverIp: cleanedProfiles.localNetwork.ip,
        port: cleanedProfiles.localNetwork.port,
        hostname: cleanedProfiles.localNetwork.hostname || 'awlad-selim-server',
        connectionType: cleanedProfiles.activeMode,
        activeMode: cleanedProfiles.activeMode,
        profiles: cleanedProfiles,
        apiBaseUrl: applyActiveToThisDevice ? activeEndpointUrl : getConfiguredApiBaseUrl() || activeEndpointUrl || localUrl,
      },
      {
        persistToServer: true,
        applyToCurrentDevice: applyActiveToThisDevice,
        targetDeviceUrl: activeEndpointUrl,
      }
    );

    setIsSavingServer(false);
    if (!result.success) {
      setServerError(result.error || t('تعذر حفظ إعدادات الاتصال', 'Failed to save connection settings'));
      return;
    }
    setConnProfiles(cleanedProfiles);
    await loadLiveServerInfo();
    showSavedBanner(
      applyActiveToThisDevice
        ? t(
            `تم حفظ إعدادات الاتصال وتفعيل وضع (${getConnectionModeLabel(cleanedProfiles.activeMode)}) على هذا الجهاز`,
            `Connection settings saved and mode (${getConnectionModeLabel(cleanedProfiles.activeMode)}) activated on this device`
          )
        : t(
            'تم حفظ ملفات الاتصال المركزية في السيرفر بنجاح (مع إبقاء هذا الجهاز على الاتصال المحلي السريع)',
            'Central connection profiles saved on server successfully (keeping this device on fast local connection)'
          )
    );
  };

  const copyCommandOrUrl = (text: string, label: string) => {
    if (window.awladDesktop?.copyText) {
      window.awladDesktop.copyText(text);
    } else if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    showSavedBanner(t(`تم نسخ ${label}`, `Copied ${label}`));
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

      // Supports the supplied MySQL INSERT catalog (8-col or legacy 9-col with ignored img) as well as simple CSV/TXT lists.
      const sqlRows = [...rawText.matchAll(/INSERT\s+INTO\s+`?products`?\s*\([^)]*\)\s*VALUES\s*\(\s*'((?:\\'|[^'])*)'\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*(?:'[^']*'\s*,\s*)?'((?:\\'|[^'])*)'\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gim)];

      if (sqlRows.length > 0) {
        sqlRows.forEach((match, index) => {
          const [, rawName, price, oldPrice, rawDescription, stock, , categoryId] = match;
          const name = rawName.replace(/\\'/g, "'");
          const description = rawDescription.replace(/\\'/g, "'");
          const code = `AS-${String(index + 1).padStart(4, '0')}`;
          const category = categoryId === '10' ? t('مشروبات وعصائر', 'Beverages & Juices') : t('شيبسيات ومقرمشات', 'Chips & Snacks');
          const isDuplicateCode = existingCodes.has(code.toLowerCase()) || seenFileCodes.has(code.toLowerCase());
          const isDuplicateName = existingNames.has(name.toLowerCase()) || seenFileNames.has(name.toLowerCase());
          seenFileCodes.add(code.toLowerCase());
          seenFileNames.add(name.toLowerCase());
          parsedCandidates.push({
            id: `IMP-${index + 1}`, code, name, category, baseUnit: 'كرتونة',
            sourceFile: file.name, isDuplicateCode, isDuplicateName,
            isValid: name.trim().length > 1 && !isDuplicateCode, status: 'pending',
            sellingPrice: Number(price), oldPrice: Number(oldPrice),
            description: `${description} | ${t('رصيد المصدر:', 'Source Stock:')} ${stock}`,
          });
        });
      } else {
        const lines = rawText.split(/\r?\n/).filter(line => line.trim().length > 0);
        lines.forEach((line, index) => {
          const parts = line.split(/[,\t;|]/).map(part => part.trim());
          let code = '';
          let name = '';
          let category = t('مواد غذائية', 'Food Items');
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
          if (file.name.includes('شيبس') || file.name.includes('مقرمشات')) category = t('شيبسيات ومقرمشات', 'Chips & Snacks');
          else if (file.name.includes('مشروب') || file.name.includes('عصير')) category = t('مشروبات وعصائر', 'Beverages & Juices');
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
      setImportError(t('لا توجد أصناف جديدة صالحة للاستيراد (قد تكون مسجلة مسبقاً)', 'No new valid products to import (they may already be registered)'));
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
          importBatchId,
          importedFromFile: true,
          sourceFileName: item.sourceFile || importFileName,
          notes: [item.description, item.oldPrice != null ? t(`السعر السابق بالكتالوج: ${item.oldPrice}`, `Previous catalog price: ${item.oldPrice}`) : '', t(`تم الاستيراد من (${item.sourceFile}).`, `Imported from (${item.sourceFile}).`)].filter(Boolean).join(' | '),
        });
        count++;
      } catch {
        skippedDup++;
      }
    }

    setIsImportingToDb(false);
    setImportSuccessCount(count);
    if (skippedDup > 0) {
      setImportError(t(`تم تخطي (${skippedDup}) صنف لوجود تعارض في الكود أو الباركود.`, `Skipped (${skippedDup}) products due to code or barcode conflict.`));
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
      setImportError(res.error || t('تعذر مسح الأصناف المستوردة', 'Failed to delete imported products'));
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
      setPgHealthInfo({ status: 'offline', message: err?.message || t('تعذر الاتصال بخدمة السيرفر', 'Failed to reach server service') });
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
        setMigrationResult({ success: true, log: { id: 'ROLLBACK', notes: t('تم التراجع للنسخة الاحتياطية بنجاح.', 'Rolled back to backup successfully.') } });
      } else {
        setMigrationResult({ success: false, error: res.error || t('فشل التراجع', 'Rollback failed') });
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
        setMigrationResult({ success: false, error: res.error || t('فشل الترحيل', 'Migration failed') });
      }
    } catch (err: any) {
      setMigrationResult({ success: false, error: err.message });
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <div className="space-y-2.5 w-full">
      {/* Header */}
      <div className="bg-white dark:bg-[#0E1C36] px-3 py-2 rounded-lg border border-slate-200 dark:border-[#21375C] shadow-xs flex items-center justify-between">
        <div>
          <h2 className="text-sm font-black text-slate-900 dark:text-[#F3F7FC] tracking-tight">{t('إعدادات منظومة أولاد سليم الشاملة', 'AWLAD SELIM Comprehensive System Settings')}</h2>
          <p className="text-[11px] text-slate-500 dark:text-[#97AECE]">
            {t('إدارة المنشأة، ربط السيرفر المركزي، استيراد الملفات، والنسخ الاحتياطي', 'Company management, central server connection, file imports, and backups')}
          </p>
        </div>
        <div className="no-dark-surface dark:bg-white rounded-md px-2 py-0.5 border border-transparent dark:border-[#2A436E] flex items-center justify-center shrink-0">
          <img
            src="/awlad-selim-logo.png"
            alt={t('أولاد سليم', 'AWLAD SELIM')}
            className="h-8 w-auto object-contain"
          />
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-1 p-1 bg-slate-200/80 dark:bg-[#132544] dark:border dark:border-[#21375C] rounded-lg overflow-x-auto text-xs font-bold no-print">
        {[
          { key: 'account', label: t('حسابي وكلمة المرور والصلاحيات', 'My Account, Password & Permissions'), icon: User, color: 'text-[#011E58]', allowAllStaff: true },
          { key: 'general', label: t('المنشأة والطباعة', 'Company & Printing'), icon: Building2, color: 'text-[#003589]', perm: 'canManageSettings' },
          { key: 'branches', label: t('الفروع', 'Branches'), icon: GitBranch, color: 'text-[#003589]', perm: 'canManageSettings' },
          { key: 'barcode', label: t('إعدادات الباركود', 'Barcode Settings'), icon: Barcode, color: 'text-slate-700', perm: 'canManageSettings' },
          { key: 'printers', label: t('الطابعات المتعددة', 'Multiple Printers'), icon: Printer, color: 'text-[#011E58]', perm: 'canManageSettings' },
          { key: 'invoice-design', label: t('إعدادات الفاتورة', 'Invoice Design'), icon: FileText, color: 'text-[#0049B0]', perm: 'canManageSettings' },
          { key: 'mobile-config', label: t('إعدادات الموبايل', 'Mobile App Settings'), icon: Smartphone, color: 'text-[#003589]', perm: 'canManageSettings' },
          { key: 'online-sync', label: t('مزامنة أونلاين', 'Online Sync'), icon: Wifi, color: 'text-[#0049B0]', perm: 'canManageSettings' },
          ...(!isMobilePlatform
            ? [{ key: 'shortcuts', label: t('اختصارات لوحة المفاتيح', 'Keyboard Shortcuts'), icon: Keyboard, color: 'text-[#011E58]', allowAllStaff: true }]
            : []),
          { key: 'services', label: t('الخدمات', 'Services'), icon: Wrench, color: 'text-amber-700', perm: 'canManageSettings' },
          { key: 'server', label: t('إعدادات السيرفر والاتصال', 'Server & Connection Settings'), icon: Server, color: 'text-[#003589]', perm: 'canManageSettings' },
          { key: 'diagnostics', label: t('سجل التشخيص والأخطاء', 'Diagnostics & Error Log'), icon: Activity, color: 'text-rose-700', perm: 'canManageSettings' },
          { key: 'abu-selim', label: t('استيراد الملفات', 'File Import'), icon: FileSpreadsheet, color: 'text-amber-600', perm: 'canManageInventory' },
          { key: 'backup', label: t('النسخ الاحتياطي', 'Backup'), icon: Database, color: 'text-[#011E58]', perm: 'canManageSettings' },
          { key: 'migration', label: t('الترحيل و PostgreSQL', 'Migration & PostgreSQL'), icon: Layers, color: 'text-[#003589]', perm: 'canManageSettings' },
        ]
          .filter((tabItem: any) => tabItem.allowAllStaff || !tabItem.perm || currentUser?.role === 'admin' || hasPermission(tabItem.perm as any))
          .map((tab) => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as SettingsTabKey)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-white dark:bg-[#1659C8] text-[#011E58] dark:text-white shadow-xs font-black'
                    : 'text-slate-600 dark:text-[#A9BCD9] hover:text-slate-900 dark:hover:text-[#F3F7FC]'
                }`}
              >
                <TabIcon className={`w-3.5 h-3.5 ${isActive ? 'dark:text-white ' : 'dark:text-[#85B8FF] '}${tab.color}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
      </div>

      {isSaved && (
        <div className="px-2.5 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-md text-xs font-bold flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" />
          <span>{savedNotice}</span>
        </div>
      )}

      {restoreSuccess && (
        <div className="px-2.5 py-1.5 bg-emerald-50 text-emerald-900 border border-emerald-300 rounded-md text-xs font-bold flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>{restoreSuccess}</span>
        </div>
      )}

      {/* TAB 0: Staff Account, Password Change & Permissions Summary (Available to All Authenticated Staff) */}
      {activeTab === 'account' && (
        <div className="space-y-2.5 text-xs">
          <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-900">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-black text-slate-900">{currentUser?.fullName}</h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    @{currentUser?.username} · {currentUser?.jobTitle || currentUser?.role}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsAccountSwitcherOpen(true)}
                  className="min-h-[32px] px-3 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200 font-black flex items-center gap-1.5 cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>{t(`الحسابات المحفوظة على الجهاز (${savedAccounts.length})`, `Saved Accounts on Device (${savedAccounts.length})`)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => logout()}
                  className="min-h-[32px] px-3 rounded-md bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-black flex items-center gap-1.5 cursor-pointer"
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{t('تسجيل الخروج', 'Log Out')}</span>
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <h4 className="font-black text-slate-800 dark:text-[#F3F7FC] flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                <span>{t('الصلاحيات النشطة لحسابك:', 'Active Permissions for Your Account:')}</span>
              </h4>
              {currentUser?.role === 'admin' ? (
                <div className="px-2.5 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-200 dark:border-emerald-400/30 text-emerald-900 dark:text-emerald-200 font-bold">
                  {t('حساب مدير عام بصلاحيات إدارية ومالية وتشغيلية كاملة على جميع أقسام المنظومة.', 'General Manager account with full administrative, financial, and operational permissions across all system modules.')}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(currentUser?.permissions || {})
                    .filter(([, allowed]) => Boolean(allowed))
                    .map(([key]) => (
                      <span
                        key={key}
                        className="px-2 py-0.5 rounded bg-blue-50 dark:bg-[#132544] text-blue-900 dark:text-[#85B8FF] border border-blue-200 dark:border-[#2A436E] font-bold text-[11px]"
                      >
                        {PERMISSION_LABELS[key] ? (language === 'en' ? PERMISSION_LABELS[key].en : PERMISSION_LABELS[key].ar) : key}
                      </span>
                    ))}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-[#21375C] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-black text-slate-800 dark:text-[#F3F7FC]">{t('مظهر العرض (Theme)', 'Display Theme')}</h4>
                <p className="text-[11px] text-slate-500 dark:text-[#97AECE]">{t('اختيار الوضع النهاري أو الداكن أو مطابقة إعدادات الجهاز', 'Choose Light, Dark, or match system device settings')}</p>
              </div>
              <div className="inline-flex items-center gap-1 p-0.5 rounded-md bg-slate-100 dark:bg-[#132544] border border-slate-200 dark:border-[#21375C]">
                {(
                  [
                    { key: 'light', label: t('نهاري', 'Light'), icon: Sun },
                    { key: 'dark', label: t('داكن', 'Dark'), icon: Moon },
                    { key: 'system', label: t('تلقائي', 'Auto'), icon: Monitor },
                  ] as const
                ).map((opt) => {
                  const Icon = opt.icon;
                  const active = themePreference === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setThemePreference(opt.key)}
                      className={`h-7 px-2.5 rounded text-[11px] flex items-center gap-1 cursor-pointer transition-colors ${
                        active
                          ? 'bg-[var(--awlad-royal-700)] dark:bg-[#1659C8] text-white font-black shadow-xs'
                          : 'text-slate-600 dark:text-[#A9BCD9] hover:text-slate-900 dark:hover:text-[#F3F7FC] font-bold'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setAccountPasswordFeedback(null);
              if (accountNewPassword.length < 4) {
                setAccountPasswordFeedback({ type: 'error', text: t('كلمة المرور الجديدة يجب ألا تقل عن 4 أحرف.', 'New password must be at least 4 characters.') });
                return;
              }
              if (accountNewPassword !== accountConfirmPassword) {
                setAccountPasswordFeedback({ type: 'error', text: t('تأكيد كلمة المرور غير مطابق.', 'Password confirmation does not match.') });
                return;
              }
              setIsUpdatingAccountPassword(true);
              const res = await updatePassword(accountNewPassword, accountCurrentPassword || undefined);
              setIsUpdatingAccountPassword(false);
              if (res.success) {
                setAccountCurrentPassword('');
                setAccountNewPassword('');
                setAccountConfirmPassword('');
                setAccountPasswordFeedback({ type: 'success', text: t('تم تحديث كلمة المرور بنجاح وحفظها على السيرفر المركزي.', 'Password updated successfully and saved to the central server.') });
              } else {
                setAccountPasswordFeedback({ type: 'error', text: res.error || t('تعذر تغيير كلمة المرور.', 'Failed to change password.') });
              }
            }}
            className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2.5"
          >
            <h3 className="text-xs sm:text-sm font-black text-slate-900 border-b pb-1.5 flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-blue-900" />
              <span>{t('تغيير كلمة المرور الشخصية', 'Change Personal Password')}</span>
            </h3>

            {accountPasswordFeedback && (
              <div
                className={`px-2.5 py-1.5 rounded-md border font-bold flex items-center gap-1.5 ${
                  accountPasswordFeedback.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{accountPasswordFeedback.text}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('كلمة المرور الحالية:', 'Current Password:')}</label>
                <input
                  type="password"
                  dir="ltr"
                  required
                  value={accountCurrentPassword}
                  onChange={(e) => setAccountCurrentPassword(e.target.value)}
                  className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('كلمة المرور الجديدة:', 'New Password:')}</label>
                <input
                  type="password"
                  dir="ltr"
                  required
                  minLength={4}
                  value={accountNewPassword}
                  onChange={(e) => setAccountNewPassword(e.target.value)}
                  className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('تأكيد كلمة المرور الجديدة:', 'Confirm New Password:')}</label>
                <input
                  type="password"
                  dir="ltr"
                  required
                  minLength={4}
                  value={accountConfirmPassword}
                  onChange={(e) => setAccountConfirmPassword(e.target.value)}
                  className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isUpdatingAccountPassword}
                className="min-h-[32px] px-4 bg-blue-900 hover:bg-blue-950 text-white rounded-md font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isUpdatingAccountPassword ? t('جاري التحديث...', 'Updating...') : t('حفظ كلمة المرور الجديدة', 'Save New Password')}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 1: General Company & Print Settings */}
      {activeTab === 'general' && (
        <form onSubmit={handleSaveGeneral} className="space-y-2.5 text-xs">
          <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2.5">
            <h3 className="text-xs sm:text-sm font-black text-slate-900 border-b pb-1.5 flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-blue-900" />
              <span>{t('بيانات منشأة أولاد سليم ورأس الفواتير', 'AWLAD SELIM Company Profile & Invoice Header')}</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('اسم المنشأة التجاري:', 'Commercial Name:')}</label>
                <input
                  type="text"
                  required
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="w-full h-8 border border-slate-300 rounded-md px-2.5"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('الشعار والوصف الفرعي:', 'Tagline & Subtitle:')}</label>
                <input
                  type="text"
                  value={formData.companySubtitle}
                  onChange={(e) => setFormData({ ...formData, companySubtitle: e.target.value })}
                  className="w-full h-8 border border-slate-300 rounded-md px-2.5"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('رقم هاتف المحل / الإدارة 1:', 'Shop / Admin Phone 1:')}</label>
                <input
                  type="text"
                  dir="ltr"
                  value={formData.phone1}
                  onChange={(e) => setFormData({ ...formData, phone1: e.target.value })}
                  className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('رقم هاتف إضافي 2:', 'Secondary Phone 2:')}</label>
                <input
                  type="text"
                  dir="ltr"
                  value={formData.phone2}
                  onChange={(e) => setFormData({ ...formData, phone2: e.target.value })}
                  className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('رقم الفرع الرئيسي:', 'Main Branch Number:')}</label>
                <input
                  type="text"
                  dir="ltr"
                  value={formData.branchNumber || ''}
                  onChange={(e) => setFormData({ ...formData, branchNumber: e.target.value })}
                  className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('عنوان المحل / المقر الرئيسي:', 'Shop / HQ Address:')}</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full h-8 border border-slate-300 rounded-md px-2.5"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('السجل التجاري:', 'Commercial Registration:')}</label>
                <input
                  type="text"
                  value={formData.commercialRegistration}
                  onChange={(e) => setFormData({ ...formData, commercialRegistration: e.target.value })}
                  className="w-full h-8 border border-slate-300 rounded-md px-2.5"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('الرقم الضريبي:', 'Tax ID Number:')}</label>
                <input
                  type="text"
                  dir="ltr"
                  value={formData.taxNumber}
                  onChange={(e) => setFormData({ ...formData, taxNumber: e.target.value })}
                  className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Printing & Operation Settings */}
          <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2.5">
            <h3 className="text-xs sm:text-sm font-black text-slate-900 border-b pb-1.5 flex items-center gap-1.5">
              <Printer className="w-4 h-4 text-blue-900" />
              <span>{t('إعدادات الفواتير والطباعة والعمليات', 'Invoices, Printing & Operations Settings')}</span>
            </h3>

            <div>
              <label className="block text-[11px] font-bold mb-1">{t('نوع الطباعة الافتراضي عند إصدار الفاتورة:', 'Default Print Mode on Invoice Issue:')}</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, defaultPrintMode: 'a4' })}
                  className={`py-1.5 px-2.5 border rounded-md font-bold transition-all cursor-pointer ${
                    formData.defaultPrintMode === 'a4' ? 'bg-blue-900 text-white shadow-xs' : 'bg-slate-50 text-slate-700'
                  }`}
                >
                  {t('ورق قياسي A4 (مفصل)', 'Standard A4 Paper (Detailed)')}
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, defaultPrintMode: 'thermal80' })}
                  className={`py-1.5 px-2.5 border rounded-md font-bold transition-all cursor-pointer ${
                    formData.defaultPrintMode === 'thermal80' ? 'bg-blue-900 text-white shadow-xs' : 'bg-slate-50 text-slate-700'
                  }`}
                >
                  {t('طابعة إيصالات حرارية 80 مم', 'Thermal Receipt Printer 80mm')}
                </button>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, defaultPrintMode: 'thermal58' })}
                  className={`py-1.5 px-2.5 border rounded-md font-bold transition-all cursor-pointer ${
                    formData.defaultPrintMode === 'thermal58' ? 'bg-blue-900 text-white shadow-xs' : 'bg-slate-50 text-slate-700'
                  }`}
                >
                  {t('طابعة حرارية 58 مم (بلوتوث محمول)', 'Thermal Printer 58mm (Portable Bluetooth)')}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold mb-0.5">{t('الشروط والملاحظات المطبوعة أسفل الفاتورة:', 'Terms & Notes Printed at Invoice Footer:')}</label>
              <textarea
                rows={2}
                value={formData.invoiceNotes}
                onChange={(e) => setFormData({ ...formData, invoiceNotes: e.target.value })}
                className="w-full border border-slate-300 rounded-md p-2"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.allowNegativeStock}
                  onChange={(e) => setFormData({ ...formData, allowNegativeStock: e.target.checked })}
                  className="w-3.5 h-3.5 rounded text-blue-900"
                />
                <span className="font-bold text-slate-800">
                  {t('السماح بالبيع بالسالب (تجاوز رصيد المخزن في حالات الطوارئ)', 'Allow Negative Stock Sales (Override Warehouse Stock in Emergencies)')}
                </span>
              </label>

              <button
                type="submit"
                className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-900 hover:bg-blue-950 text-white font-black rounded-md shadow-xs cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{t('حفظ الإعدادات', 'Save Settings')}</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* TAB 2: Server & Connection Settings (Dual / Multi-Connection System) */}
      {activeTab === 'server' && (() => {
        const currentDeviceUrl = getConfiguredApiBaseUrl();
        const activeEndpoint = resolveModeEndpointUrl(connProfiles.activeMode, connProfiles);
        const isCurrentDeviceSameOrigin = !currentDeviceUrl && !isNativeCapacitor();
        const activePort = serverInfo?.port || connProfiles.localNetwork.port || 3000;
        const dbLabel =
          serverInfo?.databaseMode === 'postgresql-enterprise'
            ? t('PostgreSQL (قاعدة بيانات واحدة مركزية)', 'PostgreSQL (Unified Central Database)')
            : t('Local JSON Ledger (قاعدة بيانات واحدة مركزية)', 'Local JSON Ledger (Unified Central Database)');

        const modeCards: Array<{
          key: ConnectionMode;
          title: string;
          subtitle: string;
          badge: string;
          badgeClass: string;
          icon: React.ElementType;
          urlPreview: string;
        }> = [
          {
            key: 'local_network',
            title: t('الشبكة المحلية (Local Network)', 'Local Network'),
            subtitle: t('الشبكة المحلية داخل المحل عبر IP والمنفذ 3000', 'Local LAN inside store via IP and port 3000'),
            badge: t('مجاني • LAN', 'Free • LAN'),
            badgeClass: 'bg-[#EEF3FA] text-[#011E58] border-[#DCE6F5]',
            icon: Wifi,
            urlPreview: resolveModeEndpointUrl('local_network', connProfiles) || 'http://192.168.1.100:3000',
          },
          {
            key: 'free_remote',
            title: t('اتصال خارجي مجاني', 'Free Remote Connection'),
            subtitle: t('اتصال خارجي مجاني عبر Cloudflare Quick Tunnel', 'Free remote access via Cloudflare Quick Tunnel'),
            badge: t('مجاني • trycloudflare', 'Free • trycloudflare'),
            badgeClass: 'bg-[#EEF3FA] text-[#003589] border-[#DCE6F5]',
            icon: Radio,
            urlPreview: connProfiles.freeRemote.tunnelUrl || 'https://xxxx.trycloudflare.com',
          },
          {
            key: 'pro_remote',
            title: t('اتصال خارجي احترافي', 'Professional Remote Connection'),
            subtitle: t('دومين ثابت وشهادة HTTPS (Named Tunnel / Proxy)', 'Static domain & HTTPS SSL (Named Tunnel / Proxy)'),
            badge: t('احترافي • HTTPS ثابت', 'Pro • Static HTTPS'),
            badgeClass: 'bg-[#DCE6F5] text-[#011E58] border-[#003589]/30',
            icon: Globe,
            urlPreview: connProfiles.proRemote.domainUrl || 'https://erp.yourdomain.com',
          },
          {
            key: 'cloud_vps',
            title: t('اتصال سيرفر سحابي (Cloud VPS)', 'Cloud VPS Connection'),
            subtitle: t('الانتقال مستقبلاً إلى سيرفر سحابي دائم 24/7', 'Migrate later to a 24/7 Cloud VPS server'),
            badge: t('مستقبلي • Cloud VPS', 'Future • Cloud VPS'),
            badgeClass: 'bg-slate-100 text-slate-800 border-slate-300',
            icon: Cloud,
            urlPreview: connProfiles.cloudVps.vpsUrl || 'https://vps.yourdomain.com',
          },
        ];

        return (
          <div className="space-y-2.5 text-xs">
            {/* Section Title & Live Status Banner */}
            <div className="bg-[#001A49] text-white p-3 rounded-lg shadow-sm border border-[#011E58] space-y-2.5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-[#DCE6F5] font-bold block mb-0.5">
                    {t('Server & Connection Settings — إدارة أوضاع الاتصال بالسيرفر المركزي', 'Server & Connection Settings — Central Server Connection Modes')}
                  </span>
                  <h3 className="text-sm font-black flex items-center gap-2">
                    <span className="inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shrink-0"></span>
                    <span>{getConnectionModeLabel(connProfiles.activeMode)}</span>
                  </h3>
                  <p className="text-[11px] text-slate-300 mt-0.5 font-mono" dir="ltr">
                    {isCurrentDeviceSameOrigin
                      ? `Current Device: Same-Origin (Port ${activePort}) | Target Profile: ${activeEndpoint || '-'}`
                      : currentDeviceUrl || activeEndpoint || 'Not configured'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleTestConnection()}
                    disabled={isTestingServer}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-bold shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTestingServer && testingModeKey === 'active' ? 'animate-spin' : ''}`} />
                    <span>{isTestingServer && testingModeKey === 'active' ? t('جاري الفحص...', 'Testing...') : t('اختبار الاتصال الحالي', 'Test Current Connection')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePushConfigUpdate}
                    disabled={isPushingUpdate}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#011E58] hover:bg-[#003589] border border-[#2E4F86] text-white rounded-md font-bold cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isPushingUpdate ? 'animate-spin' : ''}`} />
                    <span>{isPushingUpdate ? t('جاري التعميم...', 'Broadcasting...') : t('تحديث/تعميم العنوان للأجهزة', 'Broadcast URL to Devices')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={loadLiveServerInfo}
                    disabled={isLoadingServerInfo}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md font-bold cursor-pointer"
                  >
                    <Activity className={`w-3.5 h-3.5 ${isLoadingServerInfo ? 'animate-pulse' : ''}`} />
                    <span>{t('تحديث حالة المنفذ', 'Refresh Port Status')}</span>
                  </button>
                </div>
              </div>

              {serverInfo?.tunnelStatus && (
                <div className="px-2.5 py-1.5 rounded-md bg-slate-800/80 border border-slate-700 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <Radio className={`w-3.5 h-3.5 ${serverInfo.tunnelStatus.status === 'online' ? 'text-emerald-400' : 'text-slate-400'}`} />
                    <span className="font-bold text-slate-200">
                      {t('حالة النفق السريع/الخارجي:', 'Remote Tunnel Status:')}
                      <strong className={`ms-1.5 ${serverInfo.tunnelStatus.status === 'online' ? 'text-emerald-400' : 'text-amber-300'}`}>
                        {serverInfo.tunnelStatus.status === 'online'
                          ? t('متصل (Online)', 'Online')
                          : serverInfo.tunnelStatus.status === 'starting'
                          ? t('جاري البدء...', 'Starting...')
                          : serverInfo.tunnelStatus.status === 'error'
                          ? t('خطأ في التشغيل', 'Runtime Error')
                          : t('غير مشغل محلياً', 'Not Running Locally')}
                      </strong>
                    </span>
                  </div>
                  {serverInfo.tunnelStatus.tunnelUrl && (
                    <button
                      type="button"
                      onClick={() => copyCommandOrUrl(serverInfo.tunnelStatus!.tunnelUrl, t('رابط النفق التلقائي', 'Auto Tunnel URL'))}
                      className="px-2 py-0.5 rounded bg-slate-900 border border-slate-600 text-blue-200 font-mono flex items-center gap-1 cursor-pointer"
                      dir="ltr"
                    >
                      <span>{serverInfo.tunnelStatus.tunnelUrl}</span>
                      <Copy className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 lg:grid-cols-6 gap-px bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[11px]">
                <div className="px-2.5 py-1.5 bg-slate-900/90">
                  <span className="text-slate-400 block text-[10px]">{t('نوع الاتصال النشط:', 'Active Connection Mode:')}</span>
                  <strong className="text-emerald-400 font-bold block">{getConnectionModeLabel(connProfiles.activeMode)}</strong>
                </div>
                <div className="px-2.5 py-1.5 bg-slate-900/90">
                  <span className="text-slate-400 block text-[10px]">{t('حالة السيرفر والمنفذ:', 'Server & Port Status:')}</span>
                  <strong className="text-white font-bold font-mono block" dir="ltr">
                    {serverTestResult?.success === false ? 'Check Failed' : 'Online'} • :{activePort}
                  </strong>
                </div>
                <div className="px-2.5 py-1.5 bg-slate-900/90">
                  <span className="text-slate-400 block text-[10px]">{t('حالة الإنترنت والنفق:', 'Internet & Tunnel:')}</span>
                  <strong className={`font-bold block ${typeof navigator !== 'undefined' && navigator.onLine === false ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {typeof navigator !== 'undefined' && navigator.onLine === false ? t('بدون إنترنت (LAN متاح)', 'Offline (LAN Available)') : t('الإنترنت متصل', 'Internet Connected')}
                    {serverInfo?.tunnelStatus?.status === 'online' ? ` • ${t('النفق نشط', 'Tunnel Active')}` : ''}
                  </strong>
                </div>
                <div className="px-2.5 py-1.5 bg-slate-900/90">
                  <span className="text-slate-400 block text-[10px]">{t('بروتوكول الاتصال:', 'Protocol:')}</span>
                  <strong className={`font-bold block ${(serverInfo?.httpsActive || /^https:\/\//i.test(activeEndpoint)) ? 'text-blue-300' : 'text-amber-300'}`}>
                    {serverInfo?.httpsActive || /^https:\/\//i.test(activeEndpoint) ? t('HTTPS (مشفر نشط)', 'HTTPS (Encrypted)') : t('HTTP محلي (LAN)', 'Local HTTP (LAN)')}
                  </strong>
                </div>
                <div className="px-2.5 py-1.5 bg-slate-900/90">
                  <span className="text-slate-400 block text-[10px]">{t('قاعدة البيانات الموحدة:', 'Unified Database:')}</span>
                  <strong className="text-emerald-300 font-bold block">{dbLabel}</strong>
                </div>
                <div className="px-2.5 py-1.5 bg-slate-900/90">
                  <span className="text-slate-400 block text-[10px]">{t('زمن الاستجابة:', 'Latency:')}</span>
                  <strong className="font-mono text-white font-bold block tabular-nums">
                    {serverTestResult ? `${serverTestResult.latencyMs} ms` : `${serverForm.latencyMs || 0} ms`}
                  </strong>
                </div>
              </div>

              {/* Detected LAN IPs from live /api/admin/server-info */}
              {serverInfo?.lanUrls && serverInfo.lanUrls.length > 0 && (
                <div className="px-2.5 py-1.5 rounded-md bg-slate-800/60 border border-slate-700/80 flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-300 font-bold">{t('عناوين الشبكة المحلية:', 'Local Network URLs:')}</span>
                  {serverInfo.lanUrls.map((entry) => (
                    <button
                      key={entry.url}
                      type="button"
                      onClick={() => {
                        setConnProfiles((prev) => ({
                          ...prev,
                          localNetwork: { ...prev.localNetwork, ip: entry.ip, port: serverInfo.port || prev.localNetwork.port },
                        }));
                        copyCommandOrUrl(entry.url, t('عنوان LAN', 'LAN URL'));
                      }}
                      className="px-2 py-0.5 rounded bg-slate-900 hover:bg-blue-950 border border-slate-600 text-blue-200 font-mono font-bold cursor-pointer flex items-center gap-1"
                      dir="ltr"
                      title={t('اضغط لاعتماد العنوان ونسخه', 'Click to apply and copy URL')}
                    >
                      <span>{entry.url}</span>
                      <Copy className="w-3 h-3" />
                    </button>
                  ))}
                  {serverInfo.hostname && (
                    <span className="text-[10px] text-slate-400 font-mono ms-auto" dir="ltr">
                      Host: {serverInfo.hostname}
                    </span>
                  )}
                </div>
              )}

              {serverTestResult && (
                <div
                  className={`px-2.5 py-2 rounded-md border flex items-center gap-2 ${
                    serverTestResult.success
                      ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-200'
                      : 'bg-red-950/70 border-red-500/50 text-red-200'
                  }`}
                >
                  {serverTestResult.success ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                  )}
                  <div className="space-y-0.5">
                    <span className="font-bold block">{serverTestResult.message}</span>
                    {serverTestResult.modeLabel && (
                      <span className="text-[10px] opacity-80 block">{t('المسار المختبر:', 'Tested Route:')} {serverTestResult.modeLabel}</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Electron desktop quick folder controls */}
            {desktopInfo?.isElectron && (
              <div className="bg-[#EEF3FA] border border-[#DCE6F5] rounded-lg p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="font-black text-slate-900 flex items-center gap-1.5 text-xs sm:text-sm">
                    <Monitor className="w-4 h-4 text-[#003589]" />
                    <span>{t('بيئة تطبيق سطح المكتب (Windows Desktop + Embedded Server)', 'Desktop Environment (Windows Desktop + Embedded Server)')}</span>
                  </h4>
                  <p className="text-slate-600 text-[11px] mt-0.5">
                    {t('مجلد قاعدة البيانات الموحدة:', 'Unified Database Directory:')} <span className="font-mono font-bold text-slate-900" dir="ltr">{desktopInfo.dataDir}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => window.awladDesktop?.openDataFolder()}
                    className="px-2.5 py-1 bg-white border border-[#DCE6F5] text-[#011E58] rounded-md font-bold hover:bg-[#DCE6F5] cursor-pointer"
                  >
                    {t('فتح مجلد البيانات', 'Open Data Folder')}
                  </button>
                  <button
                    type="button"
                    onClick={() => window.awladDesktop?.openBackupsFolder()}
                    className="px-2.5 py-1 bg-white border border-slate-300 text-slate-700 rounded-md font-bold hover:bg-slate-100 cursor-pointer"
                  >
                    {t('فتح النسخ الاحتياطية', 'Open Backups Folder')}
                  </button>
                </div>
              </div>
            )}

            {/* Main 4-Mode Configuration Form */}
            <form onSubmit={handleSaveServer} className="space-y-2.5">
              {/* 1. Connection Mode Selector */}
              <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b pb-1.5">
                  <div>
                    <h3 className="text-xs sm:text-sm font-black text-slate-900 flex items-center gap-1.5">
                      <Server className="w-4 h-4 text-[#003589]" />
                      <span>{t('اختيار وضع الاتصال بالسيرفر (Multi-Connection Mode)', 'Select Server Connection Mode')}</span>
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {t(
                        'جميع الأوضاع تتصل بنفس السيرفر المركزي ونفس قاعدة البيانات المالية — يمكن التبديل بينها في أي وقت دون ترحيل أو فقدان بيانات.',
                        'All modes connect to the same central server and financial database — switch anytime without migration or data loss.'
                      )}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {modeCards.map((card) => {
                    const CardIcon = card.icon;
                    const isSelected = connProfiles.activeMode === card.key;
                    return (
                      <button
                        key={card.key}
                        type="button"
                        onClick={() => {
                          setConnProfiles((prev) => ({ ...prev, activeMode: card.key }));
                          setServerError(null);
                        }}
                        className={`text-start p-2.5 rounded-lg border transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                          isSelected
                            ? 'border-blue-900 bg-blue-50/70 shadow-2xs ring-1 ring-blue-900/20'
                            : 'border-slate-200 bg-slate-50/50 hover:border-slate-300'
                        }`}
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className={`p-1.5 rounded-md ${isSelected ? 'bg-blue-900 text-white' : 'bg-white text-slate-700 border border-slate-200'}`}>
                              <CardIcon className="w-3.5 h-3.5" />
                            </span>
                            <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${card.badgeClass}`}>
                              {card.badge}
                            </span>
                          </div>
                          <div>
                            <div className="font-black text-slate-900 text-xs">{card.title}</div>
                            <div className="text-[11px] text-slate-600 mt-0.5 leading-snug">{card.subtitle}</div>
                          </div>
                        </div>
                        <div className="pt-1.5 border-t border-slate-200/80 flex items-center justify-between gap-1">
                          <span className="font-mono text-[10px] text-slate-500 truncate" dir="ltr">
                            {card.urlPreview}
                          </span>
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-blue-900 shrink-0" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {serverError && (
                <div className="px-2.5 py-2 rounded-md bg-red-50 border border-red-200 text-red-700 font-bold flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{serverError}</span>
                </div>
              )}

              {/* 2. Per-Mode Configuration Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                {/* Mode 1: Local Network */}
                <div className={`bg-white p-3 rounded-lg border shadow-xs space-y-2.5 ${connProfiles.activeMode === 'local_network' ? 'border-[#003589] ring-1 ring-[#003589]/20' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between border-b pb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Wifi className="w-4 h-4 text-[#003589]" />
                      <h4 className="font-black text-slate-900 text-xs sm:text-sm">{t('1. الشبكة المحلية (Local Network)', '1. Local Network (LAN)')}</h4>
                    </div>
                    <button
                      type="button"
                      disabled={isTestingServer}
                      onClick={() => handleTestConnection('local_network')}
                      className="px-2.5 py-1 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] font-bold text-[11px] cursor-pointer"
                    >
                      {t('اختبار المحلي', 'Test LAN')}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold mb-0.5">{t('عنوان السيرفر (Server IP):', 'Server IP Address:')}</label>
                      <input
                        type="text"
                        dir="ltr"
                        required
                        value={connProfiles.localNetwork.ip}
                        onChange={(e) =>
                          setConnProfiles((prev) => ({
                            ...prev,
                            localNetwork: { ...prev.localNetwork, ip: e.target.value },
                          }))
                        }
                        className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono text-blue-900 font-bold text-left"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold mb-0.5">{t('المنفذ (Port):', 'Port:')}</label>
                      <input
                        type="number"
                        required
                        min={1}
                        max={65535}
                        value={connProfiles.localNetwork.port}
                        onChange={(e) =>
                          setConnProfiles((prev) => ({
                            ...prev,
                            localNetwork: { ...prev.localNetwork, port: parseInt(e.target.value, 10) || 3000 },
                          }))
                        }
                        className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono text-left"
                        dir="ltr"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-bold mb-0.5">{t('اسم الجهاز (Hostname):', 'Hostname:')}</label>
                      <input
                        type="text"
                        dir="ltr"
                        value={connProfiles.localNetwork.hostname || ''}
                        onChange={(e) =>
                          setConnProfiles((prev) => ({
                            ...prev,
                            localNetwork: { ...prev.localNetwork, hostname: e.target.value },
                          }))
                        }
                        className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono text-left"
                      />
                    </div>
                  </div>

                  <div className="px-2.5 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-[11px] flex items-center justify-between gap-2">
                    <span className="text-slate-600 font-bold">{t('الرابط المحلي المعتمد:', 'Active Local URL:')}</span>
                    <span className="font-mono font-bold text-slate-900" dir="ltr">
                      {resolveModeEndpointUrl('local_network', connProfiles)}
                    </span>
                  </div>
                </div>

                {/* Mode 2: Free Remote Connection (Cloudflare Quick Tunnel) */}
                <div className={`bg-white p-3 rounded-lg border shadow-xs space-y-2.5 ${connProfiles.activeMode === 'free_remote' ? 'border-[#003589] ring-1 ring-[#003589]/20' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between border-b pb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Radio className="w-4 h-4 text-[#003589]" />
                      <h4 className="font-black text-slate-900 text-xs sm:text-sm">{t('2. الرابط الخارجي المجاني (Cloudflare Quick Tunnel)', '2. Free Remote Link (Cloudflare Quick Tunnel)')}</h4>
                    </div>
                    <button
                      type="button"
                      disabled={isTestingServer || !connProfiles.freeRemote.tunnelUrl}
                      onClick={() => handleTestConnection('free_remote')}
                      className="px-2.5 py-1 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] font-bold text-[11px] cursor-pointer disabled:opacity-40"
                    >
                      {t('اختبار الرابط', 'Test Link')}
                    </button>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold mb-0.5">{t('رابط Quick Tunnel (HTTPS):', 'Quick Tunnel URL (HTTPS):')}</label>
                    <input
                      type="url"
                      dir="ltr"
                      value={connProfiles.freeRemote.tunnelUrl}
                      onChange={(e) =>
                        setConnProfiles((prev) => ({
                          ...prev,
                          freeRemote: { ...prev.freeRemote, tunnelUrl: e.target.value },
                        }))
                      }
                      className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono text-[#011E58] font-bold text-left"
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">
                      {t('يعمل فوراً بدون دومين أو اشتراك مدفوع؛ يلتقطه السيرفر تلقائياً من', 'Works immediately without a domain or subscription; auto-captured from')} <span className="font-mono" dir="ltr">scripts/start-free-tunnel.bat</span> {t('أو يمكنك لصقه يدوياً.', 'or paste it manually.')}
                    </span>
                  </div>

                  <label className="flex items-start gap-2 p-2 rounded-md bg-slate-50 border border-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={connProfiles.freeRemote.autoDetect !== false}
                      onChange={(e) =>
                        setConnProfiles((prev) => ({
                          ...prev,
                          freeRemote: { ...prev.freeRemote, autoDetect: e.target.checked },
                        }))
                      }
                      className="w-3.5 h-3.5 mt-0.5 rounded text-[#003589]"
                    />
                    <div>
                      <span className="font-bold text-slate-800 block">{t('تحديث رابط النفق تلقائياً عند تشغيل/تغيير النفق على اللابتوب', 'Auto-update tunnel URL when restarted on host')}</span>
                      <span className="text-[10px] text-slate-500">{t('يستقبل الرابط الجديد ويرفع إصدار الاتصال لتقوم الأجهزة المتصلة بالتحديث تلقائياً.', 'Captures new URL and increments connection config version for connected devices.')}</span>
                    </div>
                  </label>

                  <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900 font-bold flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      {t('تنبيه هام: رابط Quick Tunnel المجاني', 'Notice: Free Quick Tunnel URL')} (<span className="font-mono" dir="ltr">trycloudflare.com</span>) {t('مؤقت وقد يتغير عند إعادة تشغيل النفق أو اللابتوب — وعند تغيّره يمكنك إعادة ربط أي جهاز بسهولة عبر رابط الدعوة أو مسح QR جديد.', 'is temporary and may change upon restart — you can easily re-pair devices via invite link or new QR.')}
                    </span>
                  </div>

                  <div className="p-2 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#011E58] text-[11px]">{t('تشغيل النفق المجاني مع الالتقاط التلقائي للرابط:', 'Run Free Tunnel with Auto-Capture:')}</span>
                      <button
                        type="button"
                        onClick={() => copyCommandOrUrl(`node scripts/tunnel-supervisor.mjs --mode=quick --port=${activePort}`, t('أمر مراقب النفق المجاني', 'Free Tunnel Command'))}
                        className="px-2 py-0.5 rounded bg-white border border-[#DCE6F5] text-[#003589] text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        <span>{t('نسخ الأمر', 'Copy Command')}</span>
                      </button>
                    </div>
                    <code className="block px-2 py-1.5 rounded bg-slate-900 text-blue-200 font-mono text-[10px] overflow-x-auto" dir="ltr">
                      node scripts/tunnel-supervisor.mjs --mode=quick --port={activePort}
                    </code>
                    <p className="text-[10px] text-slate-600">
                      {t('أو افتح الملف الجاهز', 'Or open')} <span className="font-mono font-bold" dir="ltr">scripts/start-free-tunnel.bat</span> ({t('يدعم أيضاً التشغيل التلقائي مع Windows via', 'also supports Windows autostart via')} <span className="font-mono" dir="ltr">install-windows-tunnel-task.ps1</span>).
                    </p>
                  </div>
                </div>

                {/* Mode 3: Professional Remote Connection */}
                <div className={`bg-white p-3 rounded-lg border shadow-xs space-y-2.5 ${connProfiles.activeMode === 'pro_remote' ? 'border-[#003589] ring-1 ring-[#003589]/20' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between border-b pb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Globe className="w-4 h-4 text-[#003589]" />
                      <h4 className="font-black text-slate-900 text-xs sm:text-sm">{t('3. الرابط الخارجي الاحترافي (Named Tunnel + Domain)', '3. Professional Remote Domain (Named Tunnel)')}</h4>
                    </div>
                    <button
                      type="button"
                      disabled={isTestingServer || !connProfiles.proRemote.domainUrl}
                      onClick={() => handleTestConnection('pro_remote')}
                      className="px-2.5 py-1 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] font-bold text-[11px] cursor-pointer disabled:opacity-40"
                    >
                      {t('اختبار الدومين', 'Test Domain')}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold mb-0.5">{t('الدومين الثابت المشفر (HTTPS):', 'Encrypted Static Domain (HTTPS):')}</label>
                      <input
                        type="url"
                        dir="ltr"
                        value={connProfiles.proRemote.domainUrl}
                        onChange={(e) =>
                          setConnProfiles((prev) => ({
                            ...prev,
                            proRemote: { ...prev.proRemote, domainUrl: e.target.value },
                          }))
                        }
                        className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono text-[#011E58] font-bold text-left"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold mb-0.5">{t('مزود البوابة الاحترافية:', 'Pro Gateway Provider:')}</label>
                      <select
                        value={connProfiles.proRemote.provider || 'cloudflare_named_tunnel'}
                        onChange={(e) =>
                          setConnProfiles((prev) => ({
                            ...prev,
                            proRemote: { ...prev.proRemote, provider: e.target.value },
                          }))
                        }
                        className="w-full h-8 border border-slate-300 rounded-md px-2 bg-white font-bold text-slate-800"
                      >
                        <option value="cloudflare_named_tunnel">{t('Cloudflare Named Tunnel (دومين العميل بدون فتح بورتات الراوتر)', 'Cloudflare Named Tunnel (Customer domain without router port forwarding)')}</option>
                        <option value="nginx_reverse_proxy">{t("Nginx Reverse Proxy + SSL (شهادة Let's Encrypt أو مملوكة للعميل)", "Nginx Reverse Proxy + SSL (Let's Encrypt or custom certificate)")}</option>
                        <option value="custom">{t('مزود أو بوابة HTTPS مخصصة حسب باقة العميل', 'Custom HTTPS Gateway Provider')}</option>
                      </select>
                      <span className="text-[10px] text-slate-500 mt-1 block">
                        {t('يدعم أي دومين مملوك للعميل ويعمل مع', 'Supports any custom domain and works with')} <span className="font-mono" dir="ltr">scripts/start-pro-tunnel.bat</span> / <span className="font-mono" dir="ltr">scripts/reverse-proxy-nginx.conf</span>.
                      </span>
                    </div>
                  </div>

                  <div className="p-2 rounded-md bg-[#EEF3FA] border border-[#DCE6F5] text-[11px] text-slate-700 space-y-0.5">
                    <div className="font-bold text-[#011E58] flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" />
                      <span>{t('أمان الأسرار والتوكنات:', 'Tokens & Secrets Security:')}</span>
                    </div>
                    <p>
                      {t('يتم حفظ التوكن الخاص بـ Cloudflare Named Tunnel', 'Cloudflare Named Tunnel token')} (<span className="font-mono" dir="ltr">CLOUDFLARE_TUNNEL_TOKEN</span>) {t('أو شهادات SSL في ملف', 'and SSL certs are kept in server')} <span className="font-mono" dir="ltr">.env</span> {t('على السيرفر فقط — ولا تُعرض أو تُحفظ أي مفاتيح سرية داخل قاعدة البيانات أو الواجهة.', 'only — no secrets are stored in database or UI.')}
                    </p>
                  </div>
                </div>

                {/* Mode 4: Cloud VPS Connection */}
                <div className={`bg-white p-3 rounded-lg border shadow-xs space-y-2.5 ${connProfiles.activeMode === 'cloud_vps' ? 'border-[#011E58] ring-1 ring-[#011E58]/20' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between border-b pb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Cloud className="w-4 h-4 text-[#011E58]" />
                      <h4 className="font-black text-slate-900 text-xs sm:text-sm">{t('4. الاتصال عبر سيرفر سحابي (Cloud VPS)', '4. Cloud VPS Server Connection')}</h4>
                    </div>
                    <button
                      type="button"
                      disabled={isTestingServer || !connProfiles.cloudVps.vpsUrl}
                      onClick={() => handleTestConnection('cloud_vps')}
                      className="px-2.5 py-1 rounded-md bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] font-bold text-[11px] cursor-pointer disabled:opacity-40"
                    >
                      {t('اختبار الـ VPS', 'Test VPS')}
                    </button>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold mb-0.5">{t('عنوان السيرفر السحابي المستقبلي (HTTPS):', 'Cloud VPS Server URL (HTTPS):')}</label>
                    <input
                      type="url"
                      dir="ltr"
                      value={connProfiles.cloudVps.vpsUrl}
                      onChange={(e) =>
                        setConnProfiles((prev) => ({
                          ...prev,
                          cloudVps: { ...prev.cloudVps, vpsUrl: e.target.value },
                        }))
                      }
                      className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono text-[#011E58] font-bold text-left"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold mb-0.5">{t('ملاحظات الاستضافة (بدون كلمات مرور أو مفاتيح):', 'Hosting Notes (No passwords or keys):')}</label>
                    <input
                      type="text"
                      value={connProfiles.cloudVps.notes || ''}
                      onChange={(e) =>
                        setConnProfiles((prev) => ({
                          ...prev,
                          cloudVps: { ...prev.cloudVps, notes: e.target.value },
                        }))
                      }
                      className="w-full h-8 border border-slate-300 rounded-md px-2.5"
                    />
                  </div>

                  <div className="p-2 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-700">
                    {t(
                      'لا يتم تفعيل أي اشتراك أو نقل بيانات تلقائي. عند قرار الانتقال إلى VPS لاحقاً، تُنقل نفس قاعدة البيانات عبر النسخ الاحتياطي أو ترحيل PostgreSQL بموافقة الإدارة فقط.',
                      'No automatic subscription or data transfer occurs. When migrating to VPS later, database moves only via backup or admin-approved PostgreSQL migration.'
                    )}
                  </div>
                </div>
              </div>

              {/* Security & Device Application Controls */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-xs space-y-2.5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label className="flex items-start gap-2 p-2 rounded-md bg-slate-50 border border-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={connProfiles.enforceHttpsForRemote !== false}
                      onChange={(e) =>
                        setConnProfiles((prev) => ({
                          ...prev,
                          enforceHttpsForRemote: e.target.checked,
                        }))
                      }
                      className="w-3.5 h-3.5 mt-0.5 rounded text-blue-900"
                    />
                    <div>
                      <span className="font-bold text-slate-900 block">{t('إلزام بروتوكول HTTPS لجميع الاتصالات الخارجية', 'Require HTTPS for all remote connections')}</span>
                      <span className="text-[10px] text-slate-500">{t('يمنع إرسال التوكنات وبيانات العملاء عبر HTTP غير المشفر خارج الشبكة المحلية.', 'Blocks sending tokens or customer data over unencrypted HTTP outside the LAN.')}</span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2 p-2 rounded-md bg-slate-50 border border-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyActiveToThisDevice}
                      onChange={(e) => setApplyActiveToThisDevice(e.target.checked)}
                      className="w-3.5 h-3.5 mt-0.5 rounded text-blue-900"
                    />
                    <div>
                      <span className="font-bold text-slate-900 block">{t('تطبيق عنوان الوضع النشط على هذا الجهاز فوراً', 'Apply active mode URL to this device immediately')}</span>
                      <span className="text-[10px] text-slate-500">
                        {t(
                          'فعّلها على أجهزة الفروع أو الموبايل. اتركها غير مفعّلة على لابتوب السيرفر الرئيسي ليبقى على الاتصال السريع المباشر (Same-Origin).',
                          'Enable on branch PCs or mobile devices. Keep unchecked on the main server laptop to stay on fast Same-Origin.'
                        )}
                      </span>
                    </div>
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100">
                  {!isNativeCapacitor() && currentDeviceUrl ? (
                    <button
                      type="button"
                      onClick={() => {
                        setConfiguredApiBaseUrl('');
                        showSavedBanner(t('تمت إعادة هذا الجهاز للاتصال المحلي المباشر (Same-Origin)', 'Reset this device to direct local connection (Same-Origin)'));
                      }}
                      className="px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold cursor-pointer"
                    >
                      {t('العودة للاتصال المباشر (Same-Origin) على هذا الجهاز', 'Revert to Direct Connection (Same-Origin)')}
                    </button>
                  ) : (
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{t('إعدادات الاتصال تُحفظ مركزياً في قاعدة البيانات الموحدة وتنطبق على Windows و Android بدون إعادة بناء.', 'Connection settings are stored centrally in the unified DB and apply across Windows & Android without rebuilds.')}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSavingServer}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-[#003589] hover:bg-[#0049B0] text-white font-black rounded-md shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSavingServer ? t('جاري الحفظ...', 'Saving...') : t('حفظ إعدادات السيرفر والاتصال', 'Save Server & Connection Settings')}</span>
                  </button>
                </div>
              </div>
            </form>

            {/* 3. Smart Device Pairing (Direct Link & QR Code) + Connected Device Management */}
            <PairingAndDevicesPanel
              users={users || []}
              activeMode={connProfiles.activeMode}
              activeEndpoint={activeEndpoint || (connProfiles.activeMode === 'local_network' ? currentDeviceUrl : '')}
              profiles={connProfiles}
              onShowToast={showSavedBanner}
            />
          </div>
        );
      })()}

      {/* TAB 3: Abu Selim Product Import (Section 8) */}
      {activeTab === 'abu-selim' && (
        <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2.5 text-xs">
          <div className="border-b pb-2">
            <h3 className="text-xs sm:text-sm font-black text-slate-900 flex items-center gap-1.5">
              <FileSpreadsheet className="w-4 h-4 text-amber-600" />
              <span>{t('استيراد وتدقيق ملفات المنتجات (Product Import Engine)', 'Product File Import & Audit Engine')}</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {t(
                'وفق تعليمات الإدارة الصارمة: استخراج أسماء المنتجات والأكواد الأصلية فقط، عدم اختراع بيانات، وترك أسعار الشراء والبيع والكميات والصور فارغة بالكامل (0) لتحديدها لاحقاً بمعرفتكم.',
                'Per strict management policy: extract only original product names and codes without inventing data, leaving purchase/sale prices, quantities, and images at 0/blank for manual setup.'
              )}
            </p>
          </div>

          {importSuccessCount !== null && (
            <div className="px-2.5 py-2 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                {t(
                  `تم استيراد (${importSuccessCount}) صنف جديد بنجاح إلى قاعدة البيانات دون أسعار أو كميات مسبقة!`,
                  `Successfully imported (${importSuccessCount}) new items to the database without preset prices or quantities!`
                )}
              </span>
            </div>
          )}

          {importError && (
            <div className="px-2.5 py-2 bg-red-50 border border-red-200 text-red-800 rounded-md font-bold flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{t(importError)}</span>
            </div>
          )}

          {deleteImportedReport && (
            <div className="px-2.5 py-2 bg-blue-50 border border-blue-200 text-blue-950 rounded-md space-y-1">
              <div className="font-black flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-blue-700" />
                <span>
                  {t(
                    `تم حذف (${deleteImportedReport.deletedCount}) صنف مستورد من الملفات بأمان.`,
                    `Safely deleted (${deleteImportedReport.deletedCount}) imported file items.`
                  )}
                </span>
              </div>
              {deleteImportedReport.skippedCount > 0 && (
                <p className="text-[11px] text-amber-800 font-bold">
                  {t(
                    `تم الحفاظ على (${deleteImportedReport.skippedCount}) صنف مستورد لارتباطها بفواتير أو حركات سابقة: `,
                    `Preserved (${deleteImportedReport.skippedCount}) imported items linked to prior invoices or movements: `
                  )}
                  {(deleteImportedReport.skippedItems || []).slice(0, 5).map((s) => `${s.name} (${s.code})`).join(', ')}
                  {deleteImportedReport.skippedCount > 5 ? '...' : ''}
                </p>
              )}
            </div>
          )}

          {/* Upload Box */}
          <div className="p-3 border border-dashed border-slate-300 rounded-lg text-center bg-slate-50/50 hover:bg-slate-50 transition-colors">
            <FileSpreadsheet className="w-7 h-7 text-slate-400 mx-auto mb-1" />
            <p className="font-bold text-slate-800 mb-0.5">
              {t('اختر ملف الأصناف (شيبسيات.txt، مشروبات.txt، tool.txt، أو ملفات CSV)', 'Select items file (chips.txt, drinks.txt, tool.txt, or CSV files)')}
            </p>
            <p className="text-[11px] text-slate-500 mb-2">
              {t('يتم فحص وتدقيق الأكواد المكررة تلقائياً وعرض معاينة تفصيلية قبل الاعتماد النهائي', 'Duplicate codes are automatically checked and a detailed preview is displayed before final approval.')}
            </p>
            <label className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-900 hover:bg-blue-950 text-white font-bold rounded-md cursor-pointer shadow-xs transition-all">
              <Upload className="w-3.5 h-3.5" />
              <span>{t('اختيار ملف الأصناف للفحص', 'Choose Items File to Scan')}</span>
              <input
                type="file"
                accept=".txt,.csv,.tsv,.sql"
                onChange={handleParseAbuSelimFile}
                className="hidden"
              />
            </label>
            {importFileName && (
              <p className="mt-2 font-mono font-bold text-blue-900 text-xs">
                {t('الملف المختار:', 'Selected File:')} {importFileName}
              </p>
            )}
          </div>

          {/* Preview Table */}
          {importCandidates.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-2.5 py-2 rounded-md border border-slate-200">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-bold text-slate-800">{t('إجمالي السجلات', 'Total Records')} ({importCandidates.length}):</span>
                  <span className="text-[11px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300 font-bold">
                    {t('صالح:', 'Valid:')} {importCandidates.filter(c => c.isValid).length}
                  </span>
                  {importCandidates.some(c => c.isDuplicateCode) && (
                    <span className="text-[11px] text-red-800 bg-red-50 px-2 py-0.5 rounded border border-red-300 font-bold">
                      {t('أكواد مكررة:', 'Duplicate Codes:')} {importCandidates.filter(c => c.isDuplicateCode).length}
                    </span>
                  )}
                  {importCandidates.some(c => c.isDuplicateName) && (
                    <span className="text-[11px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-300 font-bold">
                      {t('أسماء مكررة:', 'Duplicate Names:')} {importCandidates.filter(c => c.isDuplicateName).length}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCancelImport}
                    className="px-2.5 py-1 border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold rounded-md cursor-pointer"
                  >
                    {t('إلغاء', 'Cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={handleRequestImportConfirm}
                    disabled={isImportingToDb || importCandidates.filter(c => c.isValid).length === 0}
                    className="flex items-center gap-1 px-3 py-1 bg-[#003589] hover:bg-[#0049B0] text-white font-black rounded-md shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isImportingToDb ? t('جاري الاستيراد...', 'Importing...') : t('اعتماد واستيراد الأصناف المعتمدة', 'Approve & Import Valid Items')}</span>
                  </button>
                </div>
              </div>

              <UnifiedDataTable
                compact
                title={t('معاينة الأصناف المفحوصة قبل الاستيراد', 'Preview Scanned Items Before Import')}
                data={importCandidates.slice(0, 50).map((cand, idx) => ({ ...cand, _rowNo: idx + 1 }))}
                rowKey={(cand) => cand.id}
                searchPlaceholder={t('بحث بالكود أو اسم الصنف...', 'Search by item code or name...')}
                searchFilter={(cand, q) =>
                  cand.code.toLowerCase().includes(q) ||
                  cand.name.toLowerCase().includes(q) ||
                  (cand.category || '').toLowerCase().includes(q)
                }
                rowClassName={(cand) => (cand.isValid ? '' : 'bg-red-50/50')}
                paginated={false}
                maxHeightClassName="max-h-80"
                columns={[
                  { key: '_rowNo', header: '#', width: '44px', align: 'center', render: (cand) => <span className="text-slate-400 font-mono">{cand._rowNo}</span> },
                  { key: 'code', header: t('كود الصنف', 'Item Code'), render: (cand) => <span className="font-mono font-bold text-slate-800">{cand.code}</span> },
                  { key: 'name', header: t('اسم الصنف الأصلي', 'Original Item Name'), render: (cand) => <span className="font-bold text-slate-900">{cand.name}</span> },
                  { key: 'category', header: t('التصنيف', 'Category'), render: (cand) => <span className="text-slate-600">{t(cand.category || '')}</span> },
                  { key: 'buyPrice', header: t('سعر الشراء', 'Purchase Price'), align: 'center', render: () => <span className="text-slate-400 font-mono">0 ({t('فارغ', 'Empty')})</span> },
                  { key: 'sellPrice', header: t('سعر البيع', 'Sale Price'), align: 'center', render: () => <span className="text-slate-400 font-mono">0 ({t('فارغ', 'Empty')})</span> },
                  { key: 'stock', header: t('الرصيد', 'Stock'), align: 'center', render: () => <span className="text-slate-400 font-mono">0 ({t('فارغ', 'Empty')})</span> },
                  {
                    key: 'status',
                    header: t('حالة التدقيق', 'Audit Status'),
                    align: 'center',
                    render: (cand) =>
                      cand.isValid ? (
                        <span className="px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px] font-bold">{t('صالح', 'Valid')}</span>
                      ) : cand.isDuplicateCode ? (
                        <span className="px-2 py-0.5 rounded border border-red-200 bg-red-50 text-red-800 text-[10px] font-bold">{t('كود مكرر', 'Duplicate Code')}</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800 text-[10px] font-bold">{t('اسم مكرر', 'Duplicate Name')}</span>
                      ),
                  },
                  {
                    key: 'actions',
                    header: t('الإجراءات', 'Actions'),
                    align: 'center',
                    render: (cand) => (
                      <button
                        type="button"
                        onClick={() => handleExcludeCandidate(cand.id)}
                        className="text-red-600 hover:text-red-800 p-1 text-[10px] font-bold hover:underline cursor-pointer"
                        title={t('استبعاد هذا السجل من الاستيراد', 'Exclude this record from import')}
                      >
                        {t('استبعاد', 'Exclude')}
                      </button>
                    ),
                  },
                ]}
              />
              {importCandidates.length > 50 && (
                <p className="text-[10px] text-slate-400 text-center">
                  {t(
                    `يتم عرض أول 50 صنف من أصل ${importCandidates.length} صنف تم فحصها`,
                    `Showing first 50 of ${importCandidates.length} scanned items`
                  )}
                </p>
              )}
            </div>
          )}

          {/* Safe Delete Imported Products Section */}
          <div className="p-2.5 rounded-lg bg-red-50/70 border border-red-200 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h4 className="font-black text-red-900 flex items-center gap-1.5 text-xs">
                  <Trash2 className="w-3.5 h-3.5 text-red-600" />
                  <span>
                    {t(
                      `إدارة وحذف الأصناف المستوردة من الملفات (${importedProductsList.length} صنف مستورد)`,
                      `Manage & Delete File-Imported Items (${importedProductsList.length} imported)`
                    )}
                  </span>
                </h4>
                <p className="text-[11px] text-red-800/80 mt-0.5">
                  {t(
                    'يحذف فقط الأصناف التي تم استيرادها من الملفات ولم تُستخدم في فواتير أو جرد أو تحويلات أو حركات مخزنية غير افتتاحية، مع الحفاظ التام على الأصناف المضافة يدوياً.',
                    'Deletes only file-imported items not used in invoices, stock counts, transfers, or non-opening movements, while fully preserving manually added items.'
                  )}
                </p>
              </div>
              <button
                type="button"
                disabled={importedProductsList.length === 0 || isDeletingImported}
                onClick={() => setShowDeleteImportedConfirm(true)}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md font-black text-xs shadow-xs disabled:opacity-40 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {selectedDeleteBatchId === 'all'
                    ? t('مسح جميع الأصناف المستوردة من الملفات', 'Delete All File-Imported Items')
                    : t('مسح أصناف الدفعة المحددة فقط', 'Delete Selected Batch Items Only')}
                </span>
              </button>
            </div>

            {importBatches.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1.5 border-t border-red-200/60">
                <label className="text-[11px] font-bold text-red-950 shrink-0">{t('نطاق الحذف:', 'Delete Scope:')}</label>
                <select
                  value={selectedDeleteBatchId}
                  onChange={(e) => setSelectedDeleteBatchId(e.target.value)}
                  className="h-8 bg-white border border-red-200 rounded-md px-2.5 text-xs font-bold text-slate-800"
                >
                  <option value="all">
                    {t(`جميع الأصناف المستوردة من الملفات (${importedProductsList.length} صنف)`, `All file-imported items (${importedProductsList.length} items)`)}
                  </option>
                  {importBatches
                    .filter((b) => b.batchId !== 'UNBATCHED')
                    .map((b) => (
                      <option key={b.batchId} value={b.batchId}>
                        {t('دفعة:', 'Batch:')} {b.fileName} — {b.batchId} ({b.count} {t('صنف', 'items')})
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
            title={t('اعتماد استيراد الأصناف من الملف', 'Approve File Items Import')}
            message={t(
              `هل أنت متأكد من استيراد (${importCandidates.filter(c => c.isValid).length}) صنف جديد من ملف (${importFileName})؟`,
              `Are you sure you want to import (${importCandidates.filter(c => c.isValid).length}) new items from (${importFileName})?`
            )}
            confirmLabel={t('استيراد وحفظ الأصناف', 'Import & Save Items')}
            variant="info"
            isLoading={isImportingToDb}
          />

          <ConfirmDialog
            isOpen={showDeleteImportedConfirm}
            onClose={() => setShowDeleteImportedConfirm(false)}
            onConfirm={handleExecuteDeleteImported}
            title={selectedDeleteBatchId === 'all' ? t('مسح جميع الأصناف المستوردة من الملفات', 'Delete All File-Imported Items') : t('مسح أصناف دفعة الاستيراد المحددة', 'Delete Selected Import Batch Items')}
            message={(() => {
              const targetCount =
                selectedDeleteBatchId === 'all'
                  ? importedProductsList.length
                  : importBatches.find((b) => b.batchId === selectedDeleteBatchId)?.count || importedProductsList.length;
              return t(
                `سيتم حذف الأصناف المستوردة (${targetCount} صنف في النطاق المحدد) بشرط عدم ارتباطها بأي فواتير أو مرتجعات أو طلبات أو جرد أو تحويلات أو حركات مخزنية. الأصناف المضافة يدوياً أو المرتبطة بحركات لن تُحذف. هل تريد المتابعة؟`,
                `Imported items (${targetCount} in selected scope) will be deleted provided they have no linked invoices, returns, orders, stock counts, transfers, or inventory movements. Manually added or linked items will not be deleted. Continue?`
              );
            })()}
            confirmLabel={t('نعم، مسح الأصناف غير المستخدمة', 'Yes, Delete Unused Items')}
            variant="danger"
            isLoading={isDeletingImported}
          />
        </div>
      )}

      {/* TAB 5: Backup & Restore */}
      {activeTab === 'backup' && (
        <div className="space-y-2.5 text-xs">
          <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2.5 text-xs">
            <h3 className="text-xs sm:text-sm font-black text-slate-900 border-b pb-1.5 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-blue-900" />
              <span>{t('النسخ الاحتياطي واستعادة قاعدة البيانات (Backup & Recovery)', 'Database Backup & Recovery')}</span>
            </h3>
            <p className="text-[11px] text-slate-500">
              {t(
                'يمكنك في أي وقت تنزيل نسخة احتياطية كاملة ومأمونة من كافة فواتير المبيعات، المشتريات، حركة الخزائن، حسابات العملاء والموردين بصيغة JSON، واستعادتها على أي جهاز كمبيوتر أو هاتف محمول.',
                'Download a complete JSON backup of all sales/purchase invoices, cashbox movements, customer/supplier accounts at any time, and restore it on any PC or mobile device.'
              )}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Download Backup */}
              <div className="p-2.5 bg-slate-50 border rounded-lg space-y-2">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Download className="w-4 h-4 text-blue-900" />
                  <span>{t('تصدير نسخة احتياطية كاملة', 'Export Full Backup')}</span>
                </h4>
                <p className="text-[11px] text-slate-500">
                  {t(
                    'توليد ملف مشفر ومفصل لجميع قيود المنظومة لحفظه على قرص خارجي أو فلاش ميموري',
                    'Generate an encrypted detailed file of all system records for external drive or USB storage'
                  )}
                </p>
                <button
                  type="button"
                  onClick={exportBackup}
                  className="w-full py-1.5 px-3 bg-blue-900 hover:bg-blue-950 text-white font-bold rounded-md shadow-xs text-center cursor-pointer"
                >
                  {t('تنزيل ملف النسخة الاحتياطية الآن', 'Download Backup File Now')}
                </button>
              </div>

              {/* Restore Backup */}
              <div className="p-2.5 bg-slate-50 border rounded-lg space-y-2">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Upload className="w-4 h-4 text-[#003589]" />
                  <span>{t('استعادة نسخة احتياطية سابقة', 'Restore Previous Backup')}</span>
                </h4>
                <p className="text-[11px] text-slate-500">
                  {t(
                    'رفع ملف النسخة الاحتياطية (JSON) واسترجاع كامل العمليات والأرصدة بأمان',
                    'Upload a JSON backup file to safely recover all operations and balances'
                  )}
                </p>
                <label className="w-full block py-1.5 px-3 bg-[#003589] hover:bg-[#0049B0] text-white font-bold rounded-md text-center cursor-pointer shadow-xs">
                  <span>{t('اختر ملف النسخة واستعادتها', 'Select & Restore Backup File')}</span>
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
        <div className="space-y-2.5 text-xs">
          {/* PostgreSQL Engine & Health Banner */}
          <div className="bg-[#001A49] text-white p-3 rounded-lg shadow-sm border border-[#011E58] space-y-2.5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-[#DCE6F5] font-bold block mb-0.5">
                  {t('قاعدة البيانات المركزية والخادم المحلي (PostgreSQL Relational Engine)', 'Central Database & Local Server (PostgreSQL Relational Engine)')}
                </span>
                <h3 className="text-sm font-black flex items-center gap-2">
                  <span className="inline-flex rounded-full h-2.5 w-2.5 bg-[#0053BE] shrink-0"></span>
                  <span>{t('PostgreSQL 16 Enterprise · awlad_selim · 20 مستخدم متزامن', 'PostgreSQL 16 Enterprise · awlad_selim · 20 Concurrent Users')}</span>
                </h3>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  {t(
                    'نظام المعاملات المالية والمخزنية المتسقة (ACID Transactions)، المفاتيح الأجنبية، الفهارس وسجلات التدقيق المتقدمة.',
                    'Consistent financial & inventory ACID Transactions, foreign keys, indexing, and advanced audit logs.'
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCheckPostgres}
                  disabled={isTestingPg}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#011E58] hover:bg-[#002160] text-white rounded-md font-bold border border-[#003589] transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTestingPg ? 'animate-spin' : ''}`} />
                  <span>{isTestingPg ? t('جاري الفحص...', 'Checking...') : t('فحص اتصال PostgreSQL', 'Test PostgreSQL Connection')}</span>
                </button>

                <button
                  type="button"
                  onClick={handleRunMigration}
                  disabled={isMigrating}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black shadow-xs transition-all disabled:opacity-50 cursor-pointer"
                >
                  <ArrowLeftRight className={`w-3.5 h-3.5 ${isMigrating ? 'animate-spin' : ''}`} />
                  <span>{isMigrating ? t('جاري الترحيل والتحقق...', 'Migrating & Verifying...') : t('تشغيل فحص وترحيل البيانات', 'Run Data Check & Migration')}</span>
                </button>

                <button
                  type="button"
                  onClick={handleRollbackMigration}
                  disabled={isMigrating}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-bold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{t('التراجع لآخر نسخة احتياطية', 'Rollback to Last Backup')}</span>
                </button>
              </div>
            </div>

            {/* Diagnostic stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-800 border border-slate-700 rounded-md overflow-hidden text-[11px]">
              <div className="px-2.5 py-1.5 bg-slate-900/90">
                <span className="text-slate-400 block text-[10px]">{t('حالة المحرك:', 'Engine Status:')}</span>
                <strong className={pgHealthInfo?.status === 'online' ? 'text-emerald-400 font-bold' : 'text-amber-300 font-bold'}>
                  {pgHealthInfo?.status === 'online'
                    ? t('PostgreSQL متصل ويعمل', 'PostgreSQL Online & Active')
                    : pgHealthInfo?.status === 'connection_failed'
                    ? t('تعذر الاتصال بـ PostgreSQL (السجلات المحلية تعمل)', 'PostgreSQL Connection Failed (Local Stores Active)')
                    : t('PostgreSQL غير مُعدّ بعد (السجلات المحلية الآمنة تعمل)', 'PostgreSQL Not Configured Yet (Safe Local Stores Active)')}
                </strong>
              </div>
              <div className="px-2.5 py-1.5 bg-slate-900/90">
                <span className="text-slate-400 block text-[10px]">{t('استجابة الاتصال:', 'Latency:')}</span>
                <strong className="text-emerald-400 font-mono font-bold">
                  {pgHealthInfo?.latencyMs ? `${pgHealthInfo.latencyMs} ms` : t('محلي (0 ms)', 'Local (0 ms)')}
                </strong>
              </div>
              <div className="px-2.5 py-1.5 bg-slate-900/90">
                <span className="text-slate-400 block text-[10px]">{t('قاعدة البيانات:', 'Database:')}</span>
                <strong className="text-slate-200 font-mono font-bold">
                  {pgHealthInfo?.databaseName || 'awlad_selim (v3.0)'}
                </strong>
              </div>
              <div className="px-2.5 py-1.5 bg-slate-900/90">
                <span className="text-slate-400 block text-[10px]">{t('المعاملات المالية:', 'Transactions:')}</span>
                <strong className="text-emerald-400 font-bold">ACID Enabled / Idempotent</strong>
              </div>
            </div>

            {pgHealthInfo && (
              <div className={`px-2.5 py-1.5 rounded-md text-xs ${pgHealthInfo.status === 'online' ? 'bg-emerald-950/60 text-emerald-200 border border-emerald-800/60' : 'bg-slate-800/90 text-amber-200 border border-amber-700/40'}`}>
                <p><strong>{t('نتيجة الفحص:', 'Check Result:')}</strong> {t(pgHealthInfo.message || '')}</p>
                {pgHealthInfo.status !== 'online' && (
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    {t(
                      'ملاحظة: تبقى جميع بياناتك الحالية محفوظة بالكامل دون حذف أو تصفير. لن يبدأ الترحيل الفعلي إلا بعد إعداد متغيرات اتصال PostgreSQL وتشغيل الخدمة وأخذ نسخة احتياطية تلقائية.',
                      'Note: All existing data remains completely preserved. Actual migration begins only after PostgreSQL connection vars are set, service starts, and automatic backup completes.'
                    )}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Live Migration Result Card */}
          {migrationResult && (
            <div className={`p-3 rounded-lg border ${
              migrationResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-950' : 'bg-red-50 border-red-200 text-red-950'
            } shadow-xs space-y-2`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {migrationResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-600" />
                  )}
                  <h4 className="font-black text-xs sm:text-sm">
                    {migrationResult.success ? t('تم فحص وترحيل البيانات وتوثيقها في سجل الترحيل بنجاح!', 'Data verified, migrated, and recorded in migration log successfully!') : t('تعذر تنفيذ الترحيل', 'Migration failed')}
                  </h4>
                </div>
                {migrationResult.log?.id && (
                  <span className={`font-mono text-xs font-bold bg-white/80 px-2 py-0.5 rounded border ${migrationResult.success ? 'border-emerald-300' : 'border-red-300'}`}>
                    {migrationResult.log.id}
                  </span>
                )}
              </div>

              <p className={`text-xs font-semibold ${migrationResult.success ? 'text-emerald-800' : 'text-red-800'}`}>
                {migrationResult.success ? t(migrationResult.log?.notes || '') : t(migrationResult.error || '')}
              </p>

              {(() => {
                const warnings = migrationResult.log?.details?.warnings || migrationResult.log?.warnings;
                return Array.isArray(warnings) && warnings.length > 0 ? (
                  <div className="p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 space-y-0.5">
                    <strong className="block">{t('تحذيرات الترحيل وربط العملاء:', 'Migration & Customer Linking Warnings:')}</strong>
                    {warnings.map((w: string, idx: number) => (
                      <div key={idx}>• {t(w)}</div>
                    ))}
                  </div>
                ) : null;
              })()}

              {/* Breakdown Grid */}
              {migrationResult.log?.details && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-emerald-200 border border-emerald-200 rounded-md overflow-hidden">
                  <div className="px-2 py-1.5 bg-white text-center">
                    <span className="text-[10px] text-slate-500 block">{t('المستخدمون', 'Users')}</span>
                    <strong className="text-xs font-black text-emerald-900 font-mono tabular-nums">{migrationResult.log.details.users}</strong>
                  </div>
                  <div className="px-2 py-1.5 bg-white text-center">
                    <span className="text-[10px] text-slate-500 block">{t('العملاء', 'Customers')}</span>
                    <strong className="text-xs font-black text-emerald-900 font-mono tabular-nums">{migrationResult.log.details.customers}</strong>
                  </div>
                  <div className="px-2 py-1.5 bg-white text-center">
                    <span className="text-[10px] text-slate-500 block">{t('الموردون', 'Suppliers')}</span>
                    <strong className="text-xs font-black text-emerald-900 font-mono tabular-nums">{migrationResult.log.details.suppliers}</strong>
                  </div>
                  <div className="px-2 py-1.5 bg-white text-center">
                    <span className="text-[10px] text-slate-500 block">{t('الأصناف والسلع', 'Products & Items')}</span>
                    <strong className="text-xs font-black text-emerald-900 font-mono tabular-nums">{migrationResult.log.details.products}</strong>
                  </div>
                  <div className="px-2 py-1.5 bg-white text-center">
                    <span className="text-[10px] text-slate-500 block">{t('المستودعات', 'Warehouses')}</span>
                    <strong className="text-xs font-black text-emerald-900 font-mono tabular-nums">{migrationResult.log.details.warehouses}</strong>
                  </div>
                  <div className="px-2 py-1.5 bg-white text-center">
                    <span className="text-[10px] text-slate-500 block">{t('الفواتير والدفعات', 'Invoices & Payments')}</span>
                    <strong className="text-xs font-black text-emerald-900 font-mono tabular-nums">{migrationResult.log.details.invoices + (migrationResult.log.details.payments || 0)}</strong>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Migration Logs History Table */}
          <UnifiedDataTable
            compact
            title={t('سجل الترحيل التاريخي (Migration Logs)', 'Historical Migration Logs')}
            subtitle={t('توثيق عمليات الترحيل السابقة، نسب المطابقة، عدد السجلات، وهوية المنفذ', 'Record of past migrations, match rates, record counts, and executor identity')}
            data={migrationLogs || []}
            rowKey={(log) => log.id}
            searchPlaceholder={t('بحث برقم العملية أو المنفذ...', 'Search by operation ID or executor...')}
            searchFilter={(log, q) =>
              log.id.toLowerCase().includes(q) ||
              (log.executedBy || '').toLowerCase().includes(q) ||
              (log.destination || '').toLowerCase().includes(q)
            }
            emptyTitle={t('لا توجد عمليات ترحيل مسجلة بعد', 'No migration operations recorded yet')}
            emptySubtitle={t('اضغط على «تشغيل فحص وترحيل البيانات» بالأعلى لإجراء عملية ترحيل وتوثيق أولى', 'Click "Run Data Check & Migration" above to perform an initial migration')}
            columns={[
              { key: 'id', header: t('رقم العملية', 'Operation ID'), render: (log) => <span className="font-mono font-bold text-[#011E58]">{log.id}</span> },
              { key: 'timestamp', header: t('التاريخ والوقت', 'Date & Time'), render: (log) => <span className="font-mono text-slate-600 text-[11px]">{formatLocaleDateTime(log.timestamp)}</span> },
              { key: 'source', header: t('المصدر', 'Source'), render: (log) => <span className="text-slate-600 text-[11px]">{log.source}</span> },
              { key: 'destination', header: t('الوجهة', 'Destination'), render: (log) => <span className="text-slate-700 font-bold text-[11px]">{log.destination}</span> },
              { key: 'totalRecords', header: t('إجمالي السجلات', 'Total Records'), align: 'center', render: (log) => <span className="font-mono font-bold text-slate-800 tabular-nums">{log.totalRecords}</span> },
              { key: 'migratedRecords', header: t('المنقول بنجاح', 'Migrated'), align: 'center', render: (log) => <span className="font-mono font-black text-emerald-600 tabular-nums">{log.migratedRecords}</span> },
              { key: 'failedRecords', header: t('الفاشل / المرفوض', 'Failed / Rejected'), align: 'center', render: (log) => <span className="font-mono font-bold text-red-600 tabular-nums">{log.failedRecords}</span> },
              {
                key: 'status',
                header: t('الحالة', 'Status'),
                align: 'center',
                render: (log) => (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    log.status === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    log.status === 'pending' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                    'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {log.status === 'success' ? t('ناجح 100%', '100% Success') : log.status === 'pending' ? t('قيد التنفيذ', 'Pending') : t('تحذير', 'Warning')}
                  </span>
                ),
              },
              { key: 'executedBy', header: t('المنفذ', 'Executor'), render: (log) => <span className="text-slate-600 font-semibold">{log.executedBy}</span> },
            ]}
          />
        </div>
      )}
      {/* TAB: Branches Management */}
      {activeTab === 'branches' && (
        <div className="space-y-2.5 text-xs">
          <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2">
            <h3 className="text-xs sm:text-sm font-black text-slate-900 border-b pb-1.5 flex items-center gap-1.5">
              <GitBranch className="w-4 h-4 text-blue-900" />
              <span>{t('إدارة الفروع ونقاط التوزيع', 'Branches & Distribution Points Management')}</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-2 items-end">
              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('اسم الفرع *', 'Branch Name *')}</label>
                <input type="text" value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-bold" />
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('رقم الفرع', 'Branch Number')}</label>
                <input type="text" value={newBranchNumber} onChange={(e) => setNewBranchNumber(e.target.value)} className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('كود الفرع', 'Branch Code')}</label>
                <input type="text" value={newBranchCode} onChange={(e) => setNewBranchCode(e.target.value)} className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('رقم الهاتف', 'Phone Number')}</label>
                <input type="text" value={newBranchPhone} onChange={(e) => setNewBranchPhone(e.target.value)} className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono" />
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('العنوان التفصيلي', 'Detailed Address')}</label>
                <input type="text" value={newBranchAddress} onChange={(e) => setNewBranchAddress(e.target.value)} className="w-full h-8 border border-slate-300 rounded-md px-2.5" />
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('المستودع المرتبط', 'Linked Warehouse')}</label>
                <select value={newBranchWarehouseId} onChange={(e) => setNewBranchWarehouseId(e.target.value)} className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white">
                  <option value="">{t('-- ربط بمستودع --', '-- Link Warehouse --')}</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('الخزينة المرتبطة', 'Linked Cashbox')}</label>
                <select value={newBranchCashboxId} onChange={(e) => setNewBranchCashboxId(e.target.value)} className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white">
                  <option value="">{t('-- ربط بخزينة --', '-- Link Cashbox --')}</option>
                  {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!newBranchName.trim()) return;
                  const item: BranchSettingItem = {
                    id: `BR-${Date.now().toString().slice(-5)}`,
                    name: newBranchName.trim(),
                    code: newBranchCode.trim() || `BR-${branches.length + 1}`,
                    branchNumber: newBranchNumber.trim() || undefined,
                    phone: newBranchPhone.trim() || undefined,
                    address: newBranchAddress.trim() || undefined,
                    warehouseId: newBranchWarehouseId || undefined,
                    cashboxId: newBranchCashboxId || undefined,
                    isActive: true,
                  };
                  const next = [...branches, item];
                  setBranches(next);
                  setNewBranchName('');
                  setNewBranchNumber('');
                  setNewBranchCode('');
                  setNewBranchPhone('');
                  setNewBranchAddress('');
                  await persistExtraSettings({ branches: next }, t(`تمت إضافة الفرع (${item.name}) بنجاح.`, `Branch (${item.name}) added successfully.`));
                }}
                className="h-8 px-3 bg-blue-900 hover:bg-blue-950 text-white rounded-md font-black cursor-pointer"
              >
                {t('+ إضافة وحفظ الفرع', '+ Add & Save Branch')}
              </button>
            </div>
          </div>

          <UnifiedDataTable<BranchSettingItem>
            compact
            searchable={false}
            paginated={false}
            title={t('الفروع ونقاط التوزيع المسجلة', 'Registered Branches & Distribution Points')}
            data={branches}
            rowKey={(br) => br.id}
            emptyTitle={t('لا توجد فروع مضافة', 'No branches added')}
            columns={[
              { key: 'code', header: t('الكود', 'Code'), render: (br) => <span className="font-mono font-bold text-blue-900">{br.code}</span> },
              {
                key: 'branchNumber',
                header: t('رقم الفرع', 'Branch No.'),
                render: (br) => (
                  <input
                    type="text"
                    aria-label={t('رقم الفرع', 'Branch No.')}
                    value={br.branchNumber || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBranches((prev) => prev.map((b) => (b.id === br.id ? { ...b, branchNumber: val } : b)));
                    }}
                    onBlur={async () => {
                      await persistExtraSettings({ branches }, t(`تم تحديث رقم الفرع (${br.name}).`, `Updated branch number (${br.name}).`));
                    }}
                    className="w-24 border border-slate-200 rounded-lg px-2 py-1 font-mono text-xs bg-white"
                  />
                ),
              },
              { key: 'name', header: t('اسم الفرع', 'Branch Name'), render: (br) => <span className="font-black">{br.name}</span> },
              { key: 'contact', header: t('الهاتف والعنوان', 'Phone & Address'), render: (br) => <span className="text-slate-600">{[br.phone, br.address].filter(Boolean).join(' | ') || '-'}</span> },
              {
                key: 'links',
                header: t('المستودع / الخزينة', 'Warehouse / Cashbox'),
                render: (br) => (
                  <span className="text-slate-700">
                    {warehouses.find((w) => w.id === br.warehouseId)?.name || '-'} / {cashboxes.find((c) => c.id === br.cashboxId)?.name || '-'}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: t('إجراء', 'Action'),
                align: 'center',
                render: (br) =>
                  !br.isDefault ? (
                    <button
                      type="button"
                      onClick={async () => {
                        const next = branches.filter((b) => b.id !== br.id);
                        setBranches(next);
                        await persistExtraSettings({ branches: next }, t('تم حذف الفرع وتحديث الإعدادات.', 'Branch deleted and settings updated.'));
                      }}
                      className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : (
                    <span className="text-[10px] text-slate-400">{t('رئيسي', 'Main')}</span>
                  ),
              },
            ]}
          />
        </div>
      )}

      {/* TAB: Barcode Settings */}
      {activeTab === 'barcode' && (
        <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2.5 text-xs">
          <h3 className="text-xs sm:text-sm font-black text-slate-900 border-b pb-1.5 flex items-center gap-1.5">
            <Barcode className="w-4 h-4 text-blue-900" />
            <span>{t('إعدادات طباعة ملصقات الباركود', 'Barcode Label Printing Settings')}</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] font-bold mb-0.5">{t('عرض الملصق (مم):', 'Label Width (mm):')}</label>
              <input type="number" min="20" value={barcodeConfig.labelWidthMm} onChange={(e) => setBarcodeConfig({ ...barcodeConfig, labelWidthMm: Number(e.target.value) })} className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono font-bold" />
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">{t('ارتفاع الملصق (مم):', 'Label Height (mm):')}</label>
              <input type="number" min="15" value={barcodeConfig.labelHeightMm} onChange={(e) => setBarcodeConfig({ ...barcodeConfig, labelHeightMm: Number(e.target.value) })} className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono font-bold" />
            </div>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">{t('بادئة الباركود التلقائية:', 'Auto Barcode Prefix:')}</label>
              <input type="text" dir="ltr" value={barcodeConfig.prefix} onChange={(e) => setBarcodeConfig({ ...barcodeConfig, prefix: e.target.value })} className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono font-bold" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer">
              <input type="checkbox" checked={barcodeConfig.showCompanyName} onChange={(e) => setBarcodeConfig({ ...barcodeConfig, showCompanyName: e.target.checked })} />
              <span className="font-bold">{t('إظهار اسم المؤسسة على الملصق', 'Show Company Name on Label')}</span>
            </label>
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer">
              <input type="checkbox" checked={barcodeConfig.showProductCode} onChange={(e) => setBarcodeConfig({ ...barcodeConfig, showProductCode: e.target.checked })} />
              <span className="font-bold">{t('إظهار كود الصنف الداخلي', 'Show Internal Product Code')}</span>
            </label>
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer">
              <input type="checkbox" checked={barcodeConfig.showPrice} onChange={(e) => setBarcodeConfig({ ...barcodeConfig, showPrice: e.target.checked })} />
              <span className="font-bold">{t('إظهار سعر البيع بالجنيه', 'Show Sale Price')}</span>
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => persistExtraSettings({ barcodeConfig }, t('تم حفظ إعدادات الباركود بنجاح.', 'Barcode settings saved successfully.'))}
              className="px-4 py-1.5 bg-blue-900 hover:bg-blue-950 text-white rounded-md font-black cursor-pointer flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('حفظ إعدادات الباركود', 'Save Barcode Settings')}</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB: Multi-Printers */}
      {activeTab === 'printers' && (
        <div className="space-y-2.5 text-xs">
          <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2">
            <h3 className="text-xs sm:text-sm font-black text-slate-900 border-b pb-1.5 flex items-center gap-1.5">
              <Printer className="w-4 h-4 text-blue-900" />
              <span>{t('إدارة الطابعات المتعددة (الإدارة / الكاشير / الباركود)', 'Multi-Printer Management (Admin / Cashier / Barcode)')}</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('اسم الطابعة *', 'Printer Name *')}</label>
                <input type="text" value={newPrinterName} onChange={(e) => setNewPrinterName(e.target.value)} className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-bold" />
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('النوع / الدور', 'Role')}</label>
                <select value={newPrinterRole} onChange={(e) => setNewPrinterRole(e.target.value as any)} className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white">
                  <option value="a4">{t('A4 قياسية (فواتير وتقارير)', 'Standard A4 (Invoices & Reports)')}</option>
                  <option value="cashier_thermal80">{t('كاشير حرارية 80 مم', 'Cashier Thermal 80mm')}</option>
                  <option value="cashier_thermal58">{t('بلوتوث محمولة 58 مم', 'Portable Bluetooth 58mm')}</option>
                  <option value="barcode_label">{t('طابعة ملصقات باركود', 'Barcode Label Printer')}</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold mb-0.5">{t('المنفذ أو IP', 'Port or IP')}</label>
                <input type="text" dir="ltr" value={newPrinterPort} onChange={(e) => setNewPrinterPort(e.target.value)} className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono" />
              </div>
              <div className="flex items-end gap-1.5">
                <div>
                  <label className="block text-[11px] font-bold mb-0.5">{t('النسخ', 'Copies')}</label>
                  <input type="number" min="1" max="5" value={newPrinterCopies} onChange={(e) => setNewPrinterCopies(e.target.value === '' ? '' : Number(e.target.value))} className="w-16 h-8 border border-slate-300 rounded-md px-2 font-mono text-center font-bold" title={t('عدد النسخ', 'Copies')} />
                </div>
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
                      copies: Math.max(1, Number(newPrinterCopies || 1)),
                      isActive: true,
                    };
                    const next = [...printers, item];
                    setPrinters(next);
                    setNewPrinterName('');
                    setNewPrinterPort('');
                    setNewPrinterCopies('');
                    await persistExtraSettings({ printers: next }, t(`تمت إضافة الطابعة (${item.name}) بنجاح.`, `Printer (${item.name}) added successfully.`));
                  }}
                  className="flex-1 h-8 bg-blue-900 hover:bg-blue-950 text-white rounded-md font-black cursor-pointer"
                >
                  {t('+ إضافة طابعة', '+ Add Printer')}
                </button>
              </div>
            </div>
          </div>

          <UnifiedDataTable<PrinterSettingItem>
            compact
            searchable={false}
            paginated={false}
            title={t('الطابعات المعرّفة', 'Configured Printers')}
            data={printers}
            rowKey={(pr) => pr.id}
            emptyTitle={t('لا توجد طابعات مضافة', 'No printers configured')}
            columns={[
              { key: 'name', header: t('اسم الطابعة', 'Printer Name'), render: (pr) => <span className="font-black">{pr.name}</span> },
              { key: 'role', header: t('النوع', 'Type'), render: (pr) => <span className="font-mono text-blue-900">{pr.role} ({pr.paperWidthMm}mm)</span> },
              { key: 'ipOrPort', header: t('المنفذ / IP', 'Port / IP'), render: (pr) => <span className="font-mono">{pr.ipOrPort}</span> },
              { key: 'copies', header: t('النسخ', 'Copies'), align: 'center', render: (pr) => <span className="font-mono font-bold tabular-nums">{pr.copies}</span> },
              {
                key: 'actions',
                header: t('إجراء', 'Action'),
                align: 'center',
                render: (pr) => (
                  <button
                    type="button"
                    onClick={async () => {
                      const next = printers.filter((x) => x.id !== pr.id);
                      setPrinters(next);
                      await persistExtraSettings({ printers: next }, t('تم حذف الطابعة من القائمة.', 'Printer removed from list.'));
                    }}
                    className="p-1 text-red-600 hover:bg-red-50 rounded cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* TAB: Invoice Design */}
      {activeTab === 'invoice-design' && (
        <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2.5 text-xs">
          <h3 className="text-xs sm:text-sm font-black text-slate-900 border-b pb-1.5 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-blue-900" />
            <span>{t('إعدادات قالب ومحتوى الفاتورة', 'Invoice Template & Content Settings')}</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer">
              <input type="checkbox" checked={invoiceTemplate.showLogo} onChange={(e) => setInvoiceTemplate({ ...invoiceTemplate, showLogo: e.target.checked })} />
              <span className="font-bold">{t('إظهار شعار أولاد سليم في رأس الفاتورة', 'Show Awlad Selim Logo in Invoice Header')}</span>
            </label>
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer">
              <input type="checkbox" checked={invoiceTemplate.showPreviousBalance} onChange={(e) => setInvoiceTemplate({ ...invoiceTemplate, showPreviousBalance: e.target.checked })} />
              <span className="font-bold">{t('إظهار الرصيد السابق للعميل', 'Show Customer Previous Balance')}</span>
            </label>
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer">
              <input type="checkbox" checked={invoiceTemplate.showRemainingBalance} onChange={(e) => setInvoiceTemplate({ ...invoiceTemplate, showRemainingBalance: e.target.checked })} />
              <span className="font-bold">{t('إظهار الرصيد النهائي المستحق بعد الفاتورة', 'Show Final Remaining Balance After Invoice')}</span>
            </label>
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer">
              <input type="checkbox" checked={invoiceTemplate.showSignatureBoxes} onChange={(e) => setInvoiceTemplate({ ...invoiceTemplate, showSignatureBoxes: e.target.checked })} />
              <span className="font-bold">{t('إظهار خانات توقيع المستلم وأمين المخزن', 'Show Receiver & Storekeeper Signature Boxes')}</span>
            </label>
          </div>
          <div>
            <label className="block text-[11px] font-bold mb-0.5">{t('نص تذييل الفاتورة المعتمد:', 'Approved Invoice Footer Text:')}</label>
            <textarea rows={2} value={invoiceTemplate.footerText} onChange={(e) => setInvoiceTemplate({ ...invoiceTemplate, footerText: e.target.value })} className="w-full border border-slate-300 rounded-md p-2" />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => persistExtraSettings({ invoiceTemplate }, t('تم حفظ إعدادات قالب الفاتورة بنجاح.', 'Invoice template settings saved successfully.'))}
              className="px-4 py-1.5 bg-blue-900 hover:bg-blue-950 text-white rounded-md font-black cursor-pointer flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('حفظ إعدادات الفاتورة', 'Save Invoice Settings')}</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB: Mobile Config */}
      {activeTab === 'mobile-config' && (
        <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2.5 text-xs">
          <h3 className="text-xs sm:text-sm font-black text-slate-900 border-b pb-1.5 flex items-center gap-1.5">
            <Smartphone className="w-4 h-4 text-[#003589]" />
            <span>{t('إعدادات بوابة الموبايل (تطبيق العملاء وتطبيق المناديب)', 'Mobile Portal Settings (Customer App & Rep App)')}</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer">
              <input type="checkbox" checked={mobileConfig.enableCustomerApp} onChange={(e) => setMobileConfig({ ...mobileConfig, enableCustomerApp: e.target.checked })} />
              <span className="font-bold">{t('تفعيل استقبال الطلبات من تطبيق العملاء', 'Enable Receiving Orders from Customer App')}</span>
            </label>
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer">
              <input type="checkbox" checked={mobileConfig.enableRepApp} onChange={(e) => setMobileConfig({ ...mobileConfig, enableRepApp: e.target.checked })} />
              <span className="font-bold">{t('تفعيل بوابة المناديب والتحويل بالنصف', 'Enable Rep Portal & Split Transfers')}</span>
            </label>
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer">
              <input type="checkbox" checked={mobileConfig.allowCustomerPriceView} onChange={(e) => setMobileConfig({ ...mobileConfig, allowCustomerPriceView: e.target.checked })} />
              <span className="font-bold">{t('إظهار أسعار البيع للعملاء داخل التطبيق', 'Show Sale Prices to Customers in App')}</span>
            </label>
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer">
              <input type="checkbox" checked={mobileConfig.requireOrderApproval} onChange={(e) => setMobileConfig({ ...mobileConfig, requireOrderApproval: e.target.checked })} />
              <span className="font-bold">{t('اشتراط اعتماد الإدارة قبل تحويل طلب العميل لفاتورة', 'Require Management Approval Before Converting Order to Invoice')}</span>
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => persistExtraSettings({ mobileConfig }, t('تم حفظ إعدادات الموبايل بنجاح.', 'Mobile settings saved successfully.'))}
              className="px-4 py-1.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('حفظ إعدادات الموبايل', 'Save Mobile Settings')}</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB: Online Sync */}
      {activeTab === 'online-sync' && (
        <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2.5 text-xs">
          <h3 className="text-xs sm:text-sm font-black text-slate-900 border-b pb-1.5 flex items-center gap-1.5">
            <Wifi className="w-4 h-4 text-[#003589]" />
            <span>{t('إعدادات المزامنة الأونلاين والربط المركزي', 'Online Sync & Central Connectivity Settings')}</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer self-end h-8">
              <input type="checkbox" checked={onlineSyncConfig.autoSyncEnabled} onChange={(e) => setOnlineSyncConfig({ ...onlineSyncConfig, autoSyncEnabled: e.target.checked })} />
              <span className="font-bold">{t('تفعيل المزامنة التلقائية الدورية', 'Enable Periodic Auto Sync')}</span>
            </label>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">{t('فاصل المزامنة (بالثواني):', 'Sync Interval (seconds):')}</label>
              <input type="number" min="10" value={onlineSyncConfig.syncIntervalSeconds} onChange={(e) => setOnlineSyncConfig({ ...onlineSyncConfig, syncIntervalSeconds: Number(e.target.value) })} className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono font-bold" />
            </div>
            <label className="flex items-center gap-2 p-2 bg-blue-50/70 rounded-md border border-blue-200 cursor-pointer self-end h-8">
              <input
                type="checkbox"
                data-testid="mandatory-send-enabled-checkbox"
                checked={onlineSyncConfig.mandatorySendEnabled !== false}
                onChange={(e) => setOnlineSyncConfig({ ...onlineSyncConfig, mandatorySendEnabled: e.target.checked })}
              />
              <span className="font-bold text-blue-950">{t('تفعيل الإرسال الإجباري التلقائي للموبايل', 'Enable Mandatory Auto-Send for Mobile')}</span>
            </label>
            <div>
              <label className="block text-[11px] font-bold mb-0.5">{t('مدة الإرسال الإجباري التلقائي (بالدقائق):', 'Mandatory Auto-Send Interval (minutes):')}</label>
              <input
                type="number"
                min="1"
                max="1440"
                data-testid="mandatory-send-interval-input"
                value={onlineSyncConfig.mandatorySendIntervalMinutes ?? 15}
                onChange={(e) =>
                  setOnlineSyncConfig({
                    ...onlineSyncConfig,
                    mandatorySendIntervalMinutes: Math.max(1, Math.min(1440, Math.round(Number(e.target.value) || 1))),
                  })
                }
                className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono font-bold"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold mb-0.5">{t('رابط السيرفر البعيد / السحابي (اختياري):', 'Remote / Cloud Server URL (Optional):')}</label>
              <input type="text" dir="ltr" value={onlineSyncConfig.cloudEndpointUrl || ''} onChange={(e) => setOnlineSyncConfig({ ...onlineSyncConfig, cloudEndpointUrl: e.target.value })} className="w-full h-8 border border-slate-300 rounded-md px-2.5 font-mono" />
            </div>
          </div>
          <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1.5">
            {t(
              'ملاحظة: يتم مزامنة مدة الإرسال الإجباري تلقائيًا مع تطبيقات Android وiOS لتشغيل العداد التنازلي وإرسال العمليات المعلقة دون تكرار أو فقدان عند انقطاع الشبكة.',
              'Note: The mandatory auto-send interval syncs automatically with Android & iOS apps to run the countdown and send pending operations without duplication or loss during network outages.'
            )}
          </p>
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => handleTestConnection()}
              className="px-3 py-1.5 bg-[#EEF3FA] hover:bg-[#DCE6F5] text-[#011E58] border border-[#DCE6F5] rounded-md font-bold cursor-pointer"
            >
              {t('فحص الاتصال الآن', 'Test Connection Now')}
            </button>
            <button
              type="button"
              onClick={() =>
                persistExtraSettings(
                  {
                    onlineSyncConfig: {
                      ...onlineSyncConfig,
                      mandatorySendEnabled: onlineSyncConfig.mandatorySendEnabled !== false,
                      mandatorySendIntervalMinutes: Math.max(
                        1,
                        Math.min(1440, Math.round(Number(onlineSyncConfig.mandatorySendIntervalMinutes) || 15))
                      ),
                    },
                  },
                  t('تم حفظ إعدادات المزامنة والإرسال الإجباري بنجاح.', 'Sync & mandatory send settings saved successfully.')
                )
              }
              className="px-4 py-1.5 bg-[#003589] hover:bg-[#0049B0] text-white rounded-md font-black cursor-pointer flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('حفظ إعدادات المزامنة', 'Save Sync Settings')}</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB: Per-User Keyboard Shortcuts Management */}
      {activeTab === 'shortcuts' && (
        <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2.5 text-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-2">
            <div>
              <h3 className="text-xs sm:text-sm font-black text-slate-900 flex items-center gap-1.5">
                <Keyboard className="w-4 h-4 text-[#003589]" />
                <span>{t('إعدادات اختصارات لوحة المفاتيح', 'Keyboard Shortcuts Settings')} ({currentUser?.fullName})</span>
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {t(
                  'تخصيص اختصاراتك الشخصية لكل قسم ووظيفة (تعمل مباشرة دون إعادة تشغيل وتدعم العربية والإنجليزية).',
                  'Customize personal shortcuts for every module and action (work immediately without restart and support Arabic & English layouts).'
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
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
                className="flex items-center gap-1 px-2.5 py-1 bg-blue-900 hover:bg-blue-950 text-white rounded-md font-bold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('إضافة / تخصيص اختصار', 'Add / Customize Shortcut')}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowResetShortcutsConfirm(true)}
                className="flex items-center gap-1 px-2.5 py-1 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md font-bold cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t('استعادة الافتراضي', 'Restore Defaults')}</span>
              </button>
            </div>
          </div>

          {shortcutFeedback && (
            <div
              className={`px-2.5 py-1.5 rounded-md border font-bold flex items-center justify-between ${
                shortcutFeedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              <span>{t(shortcutFeedback.text)}</span>
              <button type="button" onClick={() => setShortcutFeedback(null)} className="underline text-[11px] cursor-pointer">
                {t('إغلاق', 'Close')}
              </button>
            </div>
          )}

          <div className="relative max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute start-2.5 top-2.5" />
            <input
              type="text"
              placeholder={t('ابحث عن وظيفة أو مفتاح اختصار...', 'Search action or key combo...')}
              value={shortcutSearch}
              onChange={(e) => setShortcutSearch(e.target.value)}
              className="w-full h-8 ps-8 pe-2.5 bg-slate-50 border border-slate-300 rounded-md font-bold outline-hidden focus:bg-white focus:border-blue-700"
            />
          </div>

          <div className="border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-start border-collapse">
              <thead className="bg-slate-100 border-b border-slate-200 text-[11px] text-slate-700">
                <tr>
                  <th className="px-2.5 py-1.5 font-black text-start">{t('القسم', 'Section')}</th>
                  <th className="px-2.5 py-1.5 font-black text-start">{t('الوظيفة', 'Action')}</th>
                  <th className="px-2.5 py-1.5 font-black text-center">{t('الاختصار', 'Shortcut')}</th>
                  <th className="px-2.5 py-1.5 font-black text-center">{t('إجراءات', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(['التنقل', 'المبيعات والمشتريات', 'المخزون', 'العملاء والمالية', 'عام'] as ShortcutCategory[]).flatMap((cat) =>
                  userShortcuts
                    .filter(
                      (sc) =>
                        sc.category === cat &&
                        (!shortcutSearch.trim() ||
                          sc.label.toLowerCase().includes(shortcutSearch.toLowerCase()) ||
                          t(sc.label).toLowerCase().includes(shortcutSearch.toLowerCase()) ||
                          (sc.keyCombo || '').toLowerCase().includes(shortcutSearch.toLowerCase()))
                    )
                    .map((sc) => (
                      <tr
                        key={sc.actionId}
                        className={sc.enabled === false ? 'bg-slate-50/70 opacity-65' : 'bg-white hover:bg-slate-50/70'}
                      >
                        <td className="px-2.5 py-1.5 text-[11px] font-bold text-slate-500 whitespace-nowrap">{t(sc.category)}</td>
                        <td className="px-2.5 py-1.5">
                          <span className="font-bold text-slate-900">{t(sc.label)}</span>
                          <span className="text-[10px] font-mono text-slate-400 ms-1.5">({sc.actionId})</span>
                        </td>
                        <td className="px-2.5 py-1.5 text-center whitespace-nowrap">
                          {sc.keyCombo ? (
                            <kbd
                              dir="ltr"
                              className={`inline-block px-2 py-0.5 rounded font-mono font-black text-[11px] border min-w-16 ${
                                sc.enabled !== false
                                  ? 'bg-blue-50 text-blue-950 border-blue-300'
                                  : 'bg-slate-100 text-slate-400 border-slate-200 line-through'
                              }`}
                            >
                              {sc.keyCombo}
                            </kbd>
                          ) : (
                            <span className="text-[11px] text-slate-400">{t('غير معيّن', 'Unassigned')}</span>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5 text-center whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
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
                              className="px-2 py-0.5 bg-slate-100 hover:bg-blue-100 text-slate-800 hover:text-blue-900 rounded font-bold cursor-pointer"
                            >
                              {t('تعديل', 'Edit')}
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
                                  setShortcutFeedback({ type: 'error', text: res.error ? t(res.error) : t('تعذر تحديث الحالة', 'Could not update status') });
                                } else {
                                  const nextEnabled = sc.enabled === false;
                                  setShortcutFeedback({
                                    type: 'success',
                                    text: nextEnabled
                                      ? t(`تم تفعيل اختصار (${sc.label}).`, `Enabled shortcut (${t(sc.label)}).`)
                                      : t(`تم تعطيل اختصار (${sc.label}).`, `Disabled shortcut (${t(sc.label)}).`),
                                  });
                                }
                              }}
                              title={sc.enabled === false ? t('تفعيل الاختصار', 'Enable Shortcut') : t('تعطيل الاختصار', 'Disable Shortcut')}
                              className={`p-1 rounded border cursor-pointer ${
                                sc.enabled !== false
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                  : 'bg-slate-100 text-slate-500 border-slate-300 hover:bg-slate-200'
                              }`}
                            >
                              <Power className="w-3.5 h-3.5" />
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
                                  setShortcutFeedback({
                                    type: 'success',
                                    text: t(`تم حذف مفتاح الاختصار لوظيفة (${sc.label}).`, `Removed shortcut key for (${t(sc.label)}).`),
                                  });
                                }
                              }}
                              title={t('حذف المفتاح', 'Remove Key')}
                              className="p-1 rounded text-red-500 hover:bg-red-50 border border-transparent hover:border-red-200 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>

          {/* Key Recorder Modal */}
          <Modal
            isOpen={!!recordingTarget}
            onClose={() => setRecordingTarget(null)}
            title={
              recordingTarget?.mode === 'add'
                ? t('إضافة / تخصيص اختصار لوحة مفاتيح', 'Add / Customize Keyboard Shortcut')
                : `${t('تغيير اختصار:', 'Change Shortcut:')} ${t(recordingTarget?.label || '')}`
            }
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
                    setRecorderConflict(
                      t(
                        `الاختصار (${combo}) محجوز لعمليات النظام الأساسية (نسخ/لصق/تحديد). يرجى اختيار مفتاح آخر.`,
                        `Shortcut (${combo}) is reserved for core system actions (Copy/Paste/Select). Choose another key.`
                      )
                    );
                    setRecordingTarget({ ...recordingTarget, keyCombo: combo });
                    return;
                  }
                  if (/^Shift\+[A-Z0-9]$/.test(combo)) {
                    setRecorderConflict(
                      t(
                        `الاختصار (${combo}) يتعارض مع الكتابة بالحروف الكبيرة داخل الحقول؛ أضف Ctrl أو Alt.`,
                        `Shortcut (${combo}) conflicts with uppercase typing in inputs; add Ctrl or Alt.`
                      )
                    );
                    setRecordingTarget({ ...recordingTarget, keyCombo: combo });
                    return;
                  }
                  const conflict = findConflict(combo, recordingTarget.actionId, userShortcuts);
                  if (conflict) {
                    setRecorderConflict(
                      t(
                        `تحذير: الاختصار (${combo}) مستخدم بالفعل في الوظيفة: "${conflict.label}"`,
                        `Warning: Shortcut (${combo}) is already assigned to "${t(conflict.label)}"`
                      )
                    );
                  } else {
                    setRecorderConflict(null);
                  }
                  setRecordingTarget({ ...recordingTarget, keyCombo: combo });
                }}
                className="space-y-2.5 text-xs outline-hidden"
              >
                {recordingTarget.mode === 'add' && (
                  <div>
                    <label className="block text-[11px] font-bold mb-0.5">{t('اختر الوظيفة المراد تخصيص اختصار لها:', 'Select action to assign shortcut:')}</label>
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
                      className="w-full h-8 border border-slate-300 rounded-md px-2 font-bold bg-white"
                    >
                      {userShortcutCatalog.map((def) => (
                        <option key={def.actionId} value={def.actionId}>
                          {t(def.label)} ({t(def.category)})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="p-3 rounded-lg bg-blue-50/70 border border-dashed border-blue-300 text-center space-y-1.5">
                  <p className="font-bold text-slate-700">
                    {t('اضغط الآن على مجموعة المفاتيح المطلوبة (مثل Ctrl+P أو Alt+S أو F2)', 'Press the desired key combination now (e.g., Ctrl+P, Alt+S, or F2)')}
                  </p>
                  <div className="py-1">
                    <kbd
                      dir="ltr"
                      className="inline-block px-4 py-1.5 rounded-md bg-white border border-blue-300 text-blue-950 font-mono font-black text-sm shadow-xs min-w-28"
                    >
                      {recordingTarget.keyCombo || t('في انتظار الضغط...', 'Waiting for key press...')}
                    </kbd>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    {t('يتم الحفظ اعتماداً على المفتاح الفيزيائي ليعمل مع العربية والإنجليزية.', 'Saved by physical key code to work seamlessly with both Arabic and English layouts.')}
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
                      setRecorderConflict(
                        t(
                          `الاختصار (${combo}) محجوز لعمليات النظام الأساسية (نسخ/لصق/تحديد). يرجى اختيار مفتاح آخر.`,
                          `Shortcut (${combo}) is reserved for core system actions (Copy/Paste/Select). Choose another key.`
                        )
                      );
                    } else if (/^Shift\+[A-Z0-9]$/.test(combo)) {
                      setRecorderConflict(
                        t(
                          `الاختصار (${combo}) يتعارض مع الكتابة بالحروف الكبيرة داخل الحقول؛ أضف Ctrl أو Alt.`,
                          `Shortcut (${combo}) conflicts with uppercase typing in inputs; add Ctrl or Alt.`
                        )
                      );
                    } else if (/^[A-Z0-9]$/.test(combo)) {
                      setRecorderConflict(
                        t(
                          `الاختصار (${combo}) بدون مفتاح تحكم يتعارض مع الكتابة؛ اختر Ctrl أو Alt أو مفتاح وظيفة F1-F12.`,
                          `Plain key (${combo}) without modifier conflicts with typing; choose Ctrl, Alt, or F1-F12.`
                        )
                      );
                    } else {
                      const conflict = findConflict(combo, recordingTarget.actionId, userShortcuts);
                      setRecorderConflict(
                        conflict
                          ? t(
                              `تحذير: الاختصار (${combo}) مستخدم بالفعل في الوظيفة: "${conflict.label}"`,
                              `Warning: Shortcut (${combo}) is already assigned to "${t(conflict.label)}"`
                            )
                          : null
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
                    <div className="p-2 rounded-md bg-slate-50 border border-slate-200 space-y-1.5">
                      <span className="block font-bold text-slate-700 text-[11px]">
                        {t('أو اختر مفاتيح التحكم والمفتاح يدوياً:', 'Or select modifiers and key manually:')}
                      </span>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <label className="flex items-center gap-1 font-mono font-bold text-slate-800 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={hasCtrl}
                            onChange={(e) => updateManualCombo(e.target.checked, hasAlt, hasShift, baseKey)}
                            className="w-3.5 h-3.5 rounded text-blue-900"
                          />
                          <span>Ctrl</span>
                        </label>
                        <label className="flex items-center gap-1 font-mono font-bold text-slate-800 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={hasAlt}
                            onChange={(e) => updateManualCombo(hasCtrl, e.target.checked, hasShift, baseKey)}
                            className="w-3.5 h-3.5 rounded text-blue-900"
                          />
                          <span>Alt</span>
                        </label>
                        <label className="flex items-center gap-1 font-mono font-bold text-slate-800 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={hasShift}
                            onChange={(e) => updateManualCombo(hasCtrl, hasAlt, e.target.checked, baseKey)}
                            className="w-3.5 h-3.5 rounded text-blue-900"
                          />
                          <span>Shift</span>
                        </label>
                        <select
                          dir="ltr"
                          value={baseKey}
                          onChange={(e) => updateManualCombo(hasCtrl, hasAlt, hasShift, e.target.value)}
                          className="flex-1 min-w-28 h-8 bg-white border border-slate-300 rounded-md px-2 font-mono font-bold"
                        >
                          <option value="">{t('-- اختر المفتاح --', '-- Select Key --')}</option>
                          {keyOptions.map((k) => (
                            <option key={k} value={k}>{k}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })()}

                {recorderConflict && (
                  <div className="px-2.5 py-1.5 rounded-md bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{recorderConflict}</span>
                  </div>
                )}

                <div className="flex justify-end gap-1.5 pt-2 border-t">
                  <button
                    type="button"
                    onClick={() => setRecordingTarget(null)}
                    className="px-3 py-1.5 border rounded-md font-bold cursor-pointer"
                  >
                    {t('إلغاء', 'Cancel')}
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
                        setRecorderConflict(res.error ? t(res.error) : t('تعذر حفظ الاختصار', 'Could not save shortcut'));
                      } else {
                        setRecordingTarget(null);
                        setShortcutFeedback({
                          type: 'success',
                          text: t(
                            `تم حفظ وتفعيل الاختصار (${norm}) للوظيفة (${recordingTarget.label}) فوراً.`,
                            `Saved and activated shortcut (${norm}) for (${t(recordingTarget.label)}) immediately.`
                          ),
                        });
                      }
                    }}
                    className="px-4 py-1.5 bg-blue-900 text-white rounded-md font-black disabled:opacity-50 cursor-pointer"
                  >
                    {isSavingUserShortcuts ? t('جاري الحفظ...', 'Saving...') : t('حفظ الاختصار وتفعيله', 'Save & Activate Shortcut')}
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
                setShortcutFeedback({ type: 'success', text: t('تمت استعادة كافة الاختصارات الافتراضية بنجاح.', 'All default shortcuts restored successfully.') });
              } else {
                setShortcutFeedback({ type: 'error', text: res.error ? t(res.error) : t('تعذر استعادة الافتراضي', 'Could not restore defaults') });
              }
            }}
            title={t('استعادة الاختصارات الافتراضية', 'Restore Default Shortcuts')}
            message={t('هل تريد استعادة جميع اختصارات لوحة المفاتيح الخاصة بحسابك إلى الإعدادات الافتراضية للنظام؟', 'Restore all your personal keyboard shortcuts to system defaults?')}
            confirmLabel={t('استعادة الافتراضي', 'Restore Defaults')}
            variant="warning"
            isLoading={isSavingUserShortcuts}
          />
        </div>
      )}

      {/* TAB: Services */}
      {activeTab === 'services' && (
        <div className="bg-white p-2.5 sm:p-3 rounded-lg border border-slate-200 shadow-xs space-y-2.5 text-xs">
          <h3 className="text-xs sm:text-sm font-black text-slate-900 border-b pb-1.5 flex items-center gap-1.5">
            <Wrench className="w-4 h-4 text-amber-700" />
            <span>{t('خدمات النظام والأتمتة', 'System Services & Automation')}</span>
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer">
              <input type="checkbox" checked={servicesConfig.enableBarcodeScanner} onChange={(e) => setServicesConfig({ ...servicesConfig, enableBarcodeScanner: e.target.checked })} />
              <span className="font-bold">{t('دعم قارئ الباركود USB / اللاسلكي', 'USB / Wireless Barcode Scanner Support')}</span>
            </label>
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer">
              <input type="checkbox" checked={servicesConfig.enableAutoBackup} onChange={(e) => setServicesConfig({ ...servicesConfig, enableAutoBackup: e.target.checked })} />
              <span className="font-bold">{t('إنشاء نسخ احتياطي آلي قبل التغييرات الكبرى', 'Create Auto Backup Before Major Changes')}</span>
            </label>
            <label className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border cursor-pointer">
              <input type="checkbox" checked={servicesConfig.enableWhatsAppAlerts} onChange={(e) => setServicesConfig({ ...servicesConfig, enableWhatsAppAlerts: e.target.checked })} />
              <span className="font-bold">{t('تجهيز رسائل وإشعارات واتساب للعملاء', 'Prepare Customer WhatsApp Alerts & Messages')}</span>
            </label>
          </div>
          <div>
            <label className="block text-[11px] font-bold mb-0.5">{t('رقم واتساب المؤسسة المعتمد:', 'Approved Company WhatsApp Number:')}</label>
            <input type="text" dir="ltr" value={servicesConfig.whatsappNumber || ''} onChange={(e) => setServicesConfig({ ...servicesConfig, whatsappNumber: e.target.value })} className="w-full max-w-sm h-8 border border-slate-300 rounded-md px-2.5 font-mono font-bold" />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => persistExtraSettings({ servicesConfig }, t('تم حفظ إعدادات الخدمات بنجاح.', 'Service settings saved successfully.'))}
              className="px-4 py-1.5 bg-blue-900 hover:bg-blue-950 text-white rounded-md font-black cursor-pointer flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{t('حفظ الخدمات', 'Save Services')}</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB: Diagnostic Logs */}
      {activeTab === 'diagnostics' && canManageSettings && (
        <DiagnosticLogsPanel />
      )}
    </div>
  );
};

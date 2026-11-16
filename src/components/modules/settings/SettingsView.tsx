import React, { useState, useMemo, useEffect } from 'react';
import { 
  Settings, Save, Download, Upload, Database, RefreshCw, 
  Printer, Building2, ShieldCheck, Check, AlertCircle, Trash2, RotateCcw,
  Server, Wifi, WifiOff, Activity, Monitor, Smartphone, FileSpreadsheet,
  Eye, ArrowLeftRight, CheckCircle2, ShoppingCart, User, Layers,
  Barcode, FileText, Keyboard, Wrench, GitBranch
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { apiRequest } from '../../../services/api';
import {
  ServerConnectionSettings, ProductImportCandidate,
  BranchSettingItem, PrinterSettingItem, ExtraSettingsConfig
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

const DEFAULT_SHORTCUTS = [
  { keyCombo: 'Alt + N', actionLabel: 'فاتورة بيع جديدة', targetPage: 'new-sale' },
  { keyCombo: 'Alt + P', actionLabel: 'فاتورة شراء جديدة', targetPage: 'new-purchase' },
  { keyCombo: 'Alt + C', actionLabel: 'دليل العملاء والأرصدة', targetPage: 'customers' },
  { keyCombo: 'Alt + I', actionLabel: 'المنتجات والمخزون', targetPage: 'products' },
  { keyCombo: 'Alt + R', actionLabel: 'التقارير المالية', targetPage: 'reports' },
];

export const SettingsView: React.FC<SettingsViewProps> = ({ initialTab = 'general' }) => {
  const {
    settings, updateSettings, exportBackup, importBackup,
    serverSettings, updateServerSettings, testServerConnection,
    products, addProduct, warehouses, cashboxes, migrationLogs, runMigration, rollbackMigration,
  } = useData();

  const [activeTab, setActiveTab] = useState<SettingsTabKey>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

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

  const [shortcuts, setShortcuts] = useState(extra.shortcuts || DEFAULT_SHORTCUTS);

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
      if (settings.extraSettings.shortcuts) setShortcuts(settings.extraSettings.shortcuts);
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

  // Abu Selim Products Import State
  const [importCandidates, setImportCandidates] = useState<ProductImportCandidate[]>([]);
  const [importFileName, setImportFileName] = useState<string>('');
  const [isImportingToDb, setIsImportingToDb] = useState(false);
  const [importSuccessCount, setImportSuccessCount] = useState<number | null>(null);

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
    setIsSavingServer(true);
    // ensure apiBaseUrl matches IP and port
    const updatedUrl = serverForm.serverIp.startsWith('http') 
      ? serverForm.serverIp 
      : `http://${serverForm.serverIp}:${serverForm.port}`;
    
    await updateServerSettings({
      ...serverForm,
      apiBaseUrl: updatedUrl,
    });
    setIsSavingServer(false);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
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

  const handleExecuteImport = async () => {
    // Prevent importing existing products or duplicates
    const existingCodes = new Set(products.map(p => p.code.toLowerCase().trim()));
    const validOnes = importCandidates.filter(c => c.isValid && !existingCodes.has(c.code.toLowerCase().trim()));
    
    if (validOnes.length === 0) {
      setImportError('لا توجد أصناف جديدة صالحة للاستيراد (قد تكون مسجلة مسبقاً)');
      return;
    }

    if (!window.confirm(`هل أنت متأكد من اعتماد استيراد (${validOnes.length}) صنف جديد إلى قاعدة بيانات أولاد سليم؟`)) {
      return;
    }

    setIsImportingToDb(true);
    let count = 0;
    const defaultWarehouseId = warehouses[0]?.id || 'WH-01';

    for (const item of validOnes) {
      // STRICT REQUIREMENT 8: Leave purchasePrice, sellingPrice, stock empty (0)
      // "أنا المسؤول عن إدخال الأسعار والصور والكميات"
      await addProduct({
        code: item.code,
        barcode: item.code,
        name: item.name,
        category: item.category,
        baseUnit: item.baseUnit,
        units: [],
        purchasePrice: 0, // سعر الشراء يُدخله المسؤول لاحقاً
        sellingPrice: 0, // يحدد المسؤول سعر البيع بنفسه بعد الاستيراد
        minStockLevel: 20,
        stockPerWarehouse: { [defaultWarehouseId]: 0 }, // كمية فارغة
        status: 'active',
        image: item.image,
        notes: [item.description, item.oldPrice != null ? `السعر السابق بالكتالوج: ${item.oldPrice}` : '', `تم الاستيراد من (${item.sourceFile}).`].filter(Boolean).join(' | '),
      });
      count++;
    }

    setIsImportingToDb(false);
    setImportSuccessCount(count);
    setImportCandidates([]);
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
          { key: 'general', label: 'المنشأة والطباعة', icon: Building2, color: 'text-blue-700' },
          { key: 'branches', label: 'الفروع', icon: GitBranch, color: 'text-indigo-700' },
          { key: 'barcode', label: 'إعدادات الباركود', icon: Barcode, color: 'text-slate-700' },
          { key: 'printers', label: 'الطابعات المتعددة', icon: Printer, color: 'text-blue-800' },
          { key: 'invoice-design', label: 'إعدادات الفاتورة', icon: FileText, color: 'text-cyan-700' },
          { key: 'mobile-config', label: 'إعدادات الموبايل', icon: Smartphone, color: 'text-emerald-700' },
          { key: 'online-sync', label: 'مزامنة أونلاين', icon: Wifi, color: 'text-teal-700' },
          { key: 'shortcuts', label: 'اختصارات البرنامج', icon: Keyboard, color: 'text-purple-700' },
          { key: 'services', label: 'الخدمات', icon: Wrench, color: 'text-amber-700' },
          { key: 'server', label: 'السيرفر (IP)', icon: Server, color: 'text-emerald-600' },
          { key: 'abu-selim', label: 'استيراد الملفات', icon: FileSpreadsheet, color: 'text-amber-600' },
          { key: 'backup', label: 'النسخ الاحتياطي', icon: Database, color: 'text-purple-600' },
          { key: 'migration', label: 'الترحيل و PostgreSQL', icon: Layers, color: 'text-indigo-600' },
        ].map((tab) => {
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

      {/* TAB 2: Server & Connection Settings (Section 4) */}
      {activeTab === 'server' && (
        <div className="space-y-6 text-xs">
          {/* Status summary banner */}
          <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl border border-slate-800">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold block mb-1">
                  حالة السيرفر المركزي الداخلي داخل المحل
                </span>
                <h3 className="text-base font-black flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </span>
                  <span>{serverForm.hostname} ({serverForm.apiBaseUrl})</span>
                </h3>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTestingServer}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isTestingServer ? 'animate-spin' : ''}`} />
                  <span>{isTestingServer ? 'جاري الفحص...' : 'اختبار الاتصال بالسيرفر'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-4 border-t border-slate-800 text-[11px]">
              <div className="p-2.5 rounded-xl bg-slate-800/60">
                <span className="text-slate-400 block text-[10px]">حالة السيرفر:</span>
                <strong className="text-emerald-400 font-bold">{serverTestResult?.success ? 'متصل (Online)' : 'غير مؤكد - اضغط اختبار الاتصال'}</strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-800/60">
                <span className="text-slate-400 block text-[10px]">قاعدة البيانات:</span>
                <strong className="text-emerald-400 font-bold">{serverTestResult?.success ? 'استجابة API ناجحة' : 'لم يتم التحقق من قاعدة البيانات'}</strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-800/60">
                <span className="text-slate-400 block text-[10px]">زمن الاستجابة (Latency):</span>
                <strong className="font-mono text-white font-bold">{serverForm.latencyMs} ms</strong>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-800/60">
                <span className="text-slate-400 block text-[10px]">مزامنة الشبكة:</span>
                <strong className="text-sky-400 font-bold">{serverTestResult?.success ? 'الاتصال متاح' : 'بانتظار الاختبار'}</strong>
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

          {desktopInfo?.isElectron && (
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="font-black text-slate-900 flex items-center gap-2 text-sm">
                    <Monitor className="w-4 h-4 text-emerald-700" />
                    <span>بيئة تطبيق سطح المكتب (Windows Desktop + Embedded LAN Server)</span>
                  </h4>
                  <p className="text-slate-600 text-[11px] mt-1">
                    مجلد البيانات النشط: <span className="font-mono font-bold text-slate-900" dir="ltr">{desktopInfo.dataDir}</span>
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
              {Array.isArray(desktopInfo.lanUrls) && desktopInfo.lanUrls.length > 0 && (
                <div className="pt-2 border-t border-emerald-200/70 flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-700">روابط الشبكة المحلية للمندوبين والعملاء:</span>
                  {desktopInfo.lanUrls.map((entry: { ip: string; url: string }) => (
                    <button
                      key={entry.url}
                      type="button"
                      onClick={() => {
                        window.awladDesktop?.copyText(entry.url);
                        showSavedBanner(`تم نسخ رابط الشبكة المحلية: ${entry.url}`);
                      }}
                      className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg font-mono font-bold text-blue-900 hover:bg-blue-50 cursor-pointer"
                      dir="ltr"
                      title="اضغط للنسخ"
                    >
                      {entry.url}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Server Config Form */}
          <form onSubmit={handleSaveServer} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="text-sm font-black text-slate-900 border-b pb-2 flex items-center gap-2">
              <Server className="w-4 h-4 text-emerald-700" />
              <span>إعدادات الاتصال بالسيرفر المحلي (تغيير IP دون إعادة بناء EXE)</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block font-bold mb-1">Server IP (عنوان السيرفر المحلي):</label>
                <input
                  type="text"
                  required
                  placeholder="مثال: 192.168.1.100"
                  value={serverForm.serverIp}
                  onChange={(e) => setServerForm({ ...serverForm, serverIp: e.target.value })}
                  className="w-full border rounded-xl p-2.5 font-mono text-blue-900 font-bold"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">عنوان IP الخاص بجهاز السيرفر داخل شبكة المحل</span>
              </div>

              <div>
                <label className="block font-bold mb-1">Port (المنفذ البرمجي):</label>
                <input
                  type="number"
                  required
                  value={serverForm.port}
                  onChange={(e) => setServerForm({ ...serverForm, port: parseInt(e.target.value) || 3000 })}
                  className="w-full border rounded-xl p-2.5 font-mono"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">المنفذ الافتراضي للـ API هو 3000</span>
              </div>

              <div>
                <label className="block font-bold mb-1">Hostname (اسم المضيف):</label>
                <input
                  type="text"
                  value={serverForm.hostname}
                  onChange={(e) => setServerForm({ ...serverForm, hostname: e.target.value })}
                  className="w-full border rounded-xl p-2.5 font-mono"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">نوع الاتصال:</label>
                <select
                  value={serverForm.connectionType}
                  onChange={(e) => setServerForm({ ...serverForm, connectionType: e.target.value as any })}
                  className="w-full border rounded-xl p-2.5 bg-white"
                >
                  <option value="lan">شبكة محلية داخلية (LAN / Wi-Fi المحل)</option>
                  <option value="vpn">اتصال خارجي مشفر آمن (VPN)</option>
                  <option value="reverse_proxy">Reverse Proxy مع HTTPS مشفر</option>
                  <option value="offline_local">وضع العمل بدون اتصال (Offline Cache)</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block font-bold mb-1">API Base URL المعتمد:</label>
                <input
                  type="text"
                  readOnly
                  value={serverForm.serverIp.startsWith('http') ? serverForm.serverIp : `http://${serverForm.serverIp}:${serverForm.port}`}
                  className="w-full border rounded-xl p-2.5 font-mono bg-slate-50 text-slate-600"
                />
              </div>
            </div>

            <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-slate-700 leading-relaxed text-[11px]">
              💡 <strong>ملاحظة للمهندس المسؤول:</strong> يتيح لك هذا القسم تغيير عنوان IP الخاص بالسيرفر في أي وقت عند الانتقال لراوتر جديد أو شبكة أخرى مباشرة من داخل الواجهة دون الحاجة لإعادة تجميع أو بناء ملف EXE أو APK.
            </div>

            <div className="flex justify-end pt-3">
              <button
                type="submit"
                disabled={isSavingServer}
                className="flex items-center gap-2 px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-black rounded-xl shadow-md cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{isSavingServer ? 'جاري الحفظ...' : 'حفظ إعدادات السيرفر والاتصال'}</span>
              </button>
            </div>
          </form>
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
                    onClick={handleExecuteImport}
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
          <div className="flex justify-end gap-2">
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

      {/* TAB: Shortcuts */}
      {activeTab === 'shortcuts' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4 text-xs">
          <h3 className="text-sm font-black text-slate-900 border-b pb-2 flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-purple-700" />
            <span>اختصارات البرنامج السريعة</span>
          </h3>
          <div className="space-y-2">
            {shortcuts.map((sc, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center p-2.5 bg-slate-50 rounded-xl border">
                <input
                  type="text"
                  value={sc.keyCombo}
                  onChange={(e) => setShortcuts(shortcuts.map((s, i) => (i === idx ? { ...s, keyCombo: e.target.value } : s)))}
                  className="bg-white border rounded-lg p-1.5 font-mono font-bold text-center text-blue-900"
                />
                <input
                  type="text"
                  value={sc.actionLabel}
                  onChange={(e) => setShortcuts(shortcuts.map((s, i) => (i === idx ? { ...s, actionLabel: e.target.value } : s)))}
                  className="bg-white border rounded-lg p-1.5 font-bold"
                />
                <span className="text-slate-500 font-mono text-[11px]">الشاشة: {sc.targetPage}</span>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => persistExtraSettings({ shortcuts }, 'تم حفظ اختصارات البرنامج بنجاح.')}
              className="px-6 py-2 bg-blue-900 hover:bg-blue-950 text-white rounded-xl font-black cursor-pointer flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>حفظ الاختصارات</span>
            </button>
          </div>
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

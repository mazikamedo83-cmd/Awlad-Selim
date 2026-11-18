import React, { useState, useMemo } from 'react';
import { 
  Settings, Save, Download, Upload, Database, RefreshCw, 
  Printer, Building2, ShieldCheck, Check, AlertCircle, Trash2, RotateCcw,
  Server, Wifi, WifiOff, Activity, Monitor, Smartphone, FileSpreadsheet,
  Eye, ArrowLeftRight, CheckCircle2, ShoppingCart, User, Layers
} from 'lucide-react';
import { useData } from '../../../context/DataContext';
import { ServerConnectionSettings, ProductImportCandidate } from '../../../types';

interface SettingsViewProps {
  initialTab?: 'general' | 'server' | 'abu-selim' | 'backup' | 'mobile-desktop';
}

export const SettingsView: React.FC<SettingsViewProps> = ({ initialTab = 'general' }) => {
  const { 
    settings, updateSettings, exportBackup, importBackup, resetSystemToFresh,
    serverSettings, updateServerSettings, testServerConnection,
    products, addProduct, customers, warehouses
  } = useData();

  const [activeTab, setActiveTab] = useState<'general' | 'server' | 'abu-selim' | 'backup' | 'mobile-desktop'>(initialTab);

  // General Settings Form
  const [formData, setFormData] = useState({ ...settings });
  const [isSaved, setIsSaved] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

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

  // Mobile App Preview Mode
  const [mobileRolePreview, setMobileRolePreview] = useState<'customer' | 'representative'>('customer');
  const [selectedPreviewCustomer, setSelectedPreviewCustomer] = useState<string>(customers[0]?.id || '');

  // 1. General Settings Handlers
  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSettings(formData);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  const handleResetSystem = async () => {
    const confirmed = window.confirm(
      'تحذير هام: هل أنت متأكد تماماً من تصفير كافة بيانات البرنامج وحذف كافة الأصناف والعملاء والموردين والفواتير والموظفين والمناديب نهائياً والبدء كمنظومة جديدة فارغة؟'
    );
    if (!confirmed) return;

    setIsResetting(true);
    await resetSystemToFresh();
    setIsResetting(false);
    alert('تم تصفير المنظومة بالكامل بنجاح وبدء قاعدة بيانات جديدة وفارغة.');
    window.location.reload();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const res = await importBackup(content);
      if (res.success) {
        alert('تمت استعادة قاعدة البيانات بنجاح! سيتم تحديث الصفحة الآن.');
        window.location.reload();
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
      alert('لا توجد أصناف جديدة صالحة للاستيراد (قد تكون مسجلة مسبقاً)');
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

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight">إعدادات منظومة أولاد سليم الشاملة</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            إدارة المنشأة، ربط السيرفر المركزي، استيراد ملفات أبو سليم، والنسخ الاحتياطي
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
        <button
          onClick={() => setActiveTab('general')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'general' ? 'bg-white text-blue-950 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Building2 className="w-4 h-4 text-blue-700" />
          <span>المنشأة والطباعة</span>
        </button>

        <button
          onClick={() => setActiveTab('server')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'server' ? 'bg-white text-blue-950 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Server className="w-4 h-4 text-emerald-600" />
          <span>إعدادات السيرفر والاتصال (IP)</span>
        </button>

        <button
          onClick={() => setActiveTab('abu-selim')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'abu-selim' ? 'bg-white text-blue-950 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4 text-amber-600" />
          <span>استيراد ملفات أبو سليم</span>
        </button>

        <button
          onClick={() => setActiveTab('mobile-desktop')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'mobile-desktop' ? 'bg-white text-blue-950 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Smartphone className="w-4 h-4 text-sky-600" />
          <span>تطبيق Android و Windows</span>
        </button>

        <button
          onClick={() => setActiveTab('backup')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'backup' ? 'bg-white text-blue-950 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Database className="w-4 h-4 text-purple-600" />
          <span>النسخ الاحتياطي والتصفير</span>
        </button>
      </div>

      {isSaved && (
        <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>تم حفظ الإعدادات بنجاح</span>
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
              <span>استيراد وتدقيق ملفات منتجات أبو سليم (Product Import Engine)</span>
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

      {/* TAB 4: Mobile & Desktop App Unified Hub (Section 3 & 22) */}
      {activeTab === 'mobile-desktop' && (
        <div className="space-y-6 text-xs">
          {/* Windows EXE packaging card */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Monitor className="w-5 h-5 text-blue-900" />
                <h3 className="text-sm font-black text-slate-900">برنامج إدارة أولاد سليم لأجهزة Windows (EXE Standalone)</h3>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 text-[11px] font-bold">
                جاهز للتثبيت المحلي
              </span>
            </div>
            <p className="text-slate-600 leading-relaxed">
              البرنامج يعمل كملف تنفيذي مستقل على أجهزة Windows في المحل عبر غلاف Electron أو PWA المكتبي، متصلاً مباشرة بالسيرفر المحلي (Local Server) دون أي اعتماد على إنترنت خارجي.
            </p>
            <div className="p-3 bg-slate-50 rounded-xl font-mono text-[11px] text-slate-700 flex items-center justify-between">
              <span>أمر تشغيل وبناء حزمة الويندوز المكتبي:</span>
              <code className="text-blue-900 font-bold bg-white px-2 py-1 rounded-md border">npm run build</code>
            </div>
          </div>

          {/* Unified Android App (Section 22) */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-black text-slate-900">تطبيق Android الموحد (عملاء + مناديب في تطبيق واحد)</h3>
              </div>
              {/* Role Toggle Preview */}
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setMobileRolePreview('customer')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    mobileRolePreview === 'customer' ? 'bg-white text-blue-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  واجهة العميل
                </button>
                <button
                  type="button"
                  onClick={() => setMobileRolePreview('representative')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    mobileRolePreview === 'representative' ? 'bg-white text-emerald-900 shadow-xs' : 'text-slate-600'
                  }`}
                >
                  واجهة المندوب
                </button>
              </div>
            </div>

            <p className="text-slate-600 leading-relaxed">
              وفق تعليماتكم: تسجيل دخول واحد فقط باسم <strong>AWLAD SELIM</strong>. بعد تسجيل الدخول يحدد السيرفر نوع الحساب: إذا كان عميلاً تظهر له شاشة طلبات الشراء بأسعاره المخصصة، وإذا كان مندوباً تظهر له عهدة سيارته والفواتير وطلبات التحويل.
            </p>

            {/* Simulated Mobile Mockup */}
            <div className="max-w-sm mx-auto border-4 border-slate-800 rounded-3xl p-4 bg-slate-900 text-white shadow-2xl space-y-3 font-['Cairo']">
              {/* Mobile Status Bar */}
              <div className="flex items-center justify-between text-[10px] text-slate-400 pb-2 border-b border-slate-800">
                <span>09:41 ص</span>
                <span className="font-bold text-white">AWLAD SELIM MOBILE</span>
                <span>📶 100%</span>
              </div>

              {mobileRolePreview === 'customer' ? (
                /* Customer View Preview */
                <div className="space-y-3">
                  <div className="p-3 bg-slate-800/80 rounded-2xl border border-slate-700">
                    <span className="text-[10px] text-blue-300 block">مرحباً بك يا تاجرنا العزيز</span>
                    <strong className="text-xs text-white block">محل البركة لتجارة التجزئة (عميل جملة)</strong>
                    <div className="mt-2 pt-2 border-t border-slate-700 flex justify-between text-[11px]">
                      <span className="text-slate-400">رصيد المديونية الحالي:</span>
                      <strong className="text-amber-400 font-mono">14,250 ج.م</strong>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <span className="text-[11px] font-bold text-slate-300 block">قائمة الأصناف المتاحة بأسعارك المخصصة:</span>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {products.slice(0, 3).map((p) => (
                        <div key={p.id} className="p-2 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-between text-[11px]">
                          <div>
                            <span className="font-bold block text-white">{p.name}</span>
                            <span className="text-[10px] text-slate-400">{p.category}</span>
                          </div>
                          <div className="text-left">
                            <span className="text-emerald-400 font-black block">{p.sellingPrice} ج.م</span>
                            <button className="text-[10px] px-2 py-0.5 bg-blue-600 rounded-md text-white font-bold">طلب +</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-2.5 bg-blue-950/60 rounded-xl border border-blue-500/30 text-[10px] text-blue-200">
                    * طلبات الشراء المرسلة من العميل تذهب إلى لوحة تحكم الإدارة للمراجعة والاعتماد قبل إصدار الفاتورة.
                  </div>
                </div>
              ) : (
                /* Representative View Preview */
                <div className="space-y-3">
                  <div className="p-3 bg-slate-800/80 rounded-2xl border border-slate-700">
                    <span className="text-[10px] text-emerald-400 block">بوابة المندوب الميداني</span>
                    <strong className="text-xs text-white block">المندوب: أحمد سليم (سيارة رقم 4)</strong>
                    <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-700 text-[10px]">
                      <div>
                        <span className="text-slate-400 block">العهدة المالية:</span>
                        <strong className="text-emerald-400 font-mono">22,500 ج.م</strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block">أصناف السيارة:</span>
                        <strong className="text-sky-400 font-mono">18 صنف</strong>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2.5 bg-slate-800 rounded-xl border border-slate-700 text-center font-bold">
                      <ShoppingCart className="w-4 h-4 mx-auto mb-1 text-blue-400" />
                      <span>فاتورة بيع جديدة</span>
                    </div>
                    <div className="p-2.5 bg-slate-800 rounded-xl border border-slate-700 text-center font-bold">
                      <ArrowLeftRight className="w-4 h-4 mx-auto mb-1 text-emerald-400" />
                      <span>طلب تحويل أصناف</span>
                    </div>
                  </div>

                  <div className="p-2.5 bg-emerald-950/60 rounded-xl border border-emerald-500/30 text-[10px] text-emerald-200">
                    * عند إنشاء فاتورة للعميل، تظهر آخر 3 أسعار بيع سابقة له، وإذا كانت بضاعة السيارة غير كافية يتم ربط الفاتورة بطلب تحويل عهدة للإدارة.
                  </div>
                </div>
              )}
            </div>
          </div>
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

          {/* Complete System Zero / Factory Reset */}
          <div className="bg-red-50/70 border border-red-200 p-6 rounded-2xl shadow-xs space-y-3 text-xs">
            <div className="flex items-center gap-2 text-red-900 font-black text-sm">
              <Trash2 className="w-5 h-5 text-red-600" />
              <span>تصفير المنظومة بالكامل (إعادة ضبط المصنع)</span>
            </div>
            <p className="text-red-700 leading-relaxed">
              حذف كافة البيانات المسجلة نهائياً (الأصناف، العملاء، الموردين، الفواتير، الموظفين، المناديب، والشيكات) وإعادة البرنامج كأنه جديد تماماً مع الاحتفاظ بحساب المسؤول العام الرئيسي (admin) فقط.
            </p>
            <div className="pt-1">
              <button
                type="button"
                disabled={isResetting}
                onClick={handleResetSystem}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-black rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{isResetting ? 'جاري تصفير البيانات...' : 'تصفير كل شيء وحذف كافة البيانات والبدء من جديد'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

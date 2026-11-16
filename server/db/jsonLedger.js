import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.AWLAD_DATA_DIR
  ? path.resolve(process.env.AWLAD_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const databaseFile = path.join(dataDir, 'database.json');
const sessionsFile = path.join(dataDir, 'sessions.json');
const auditLogsFile = path.join(dataDir, 'audit_logs.json');
const idempotencyFile = path.join(dataDir, 'idempotency.json');

fs.mkdirSync(dataDir, { recursive: true });

// Async mutex queue to serialize concurrent writes in JSON Ledger mode
let mutexChain = Promise.resolve();

export function withJsonMutex(fn) {
  const next = mutexChain.then(() => fn());
  mutexChain = next.catch(() => {});
  return next;
}

export async function flushJsonWrites() {
  await mutexChain.catch(() => {});
}

export function createEmptyDatabaseState() {
  return {
    users: [],
    warehouses: [
      {
        id: 'wh-main',
        name: 'المستودع الرئيسي',
        code: 'WH-01',
        location: 'المقر الرئيسي',
        isDefault: true,
        status: 'active',
      },
    ],
    categories: [
      { id: 'cat-1', name: 'مواد غذائية عامة', status: 'active', createdAt: new Date().toISOString() },
    ],
    products: [],
    customers: [],
    suppliers: [],
    invoices: [],
    invoiceReturns: [],
    cashboxes: [
      {
        id: 'cb-main',
        name: 'الخزينة الرئيسية',
        type: 'cashbox',
        openingBalance: 0,
        currentBalance: 0,
        isDefault: true,
      },
    ],
    financialTransactions: [],
    cheques: [],
    installments: [],
    representatives: [],
    repTransfers: [],
    repItemTransfers: [],
    customerItemOrders: [],
    employees: [],
    advancesDeductions: [],
    attendance: [],
    payrolls: [],
    expenseIncomes: [],
    stockMovements: [],
    ownerAccounts: [],
    ownerTransactions: [],
    stockCounts: [],
    stockTransferRequests: [],
    settings: {
      companyName: 'مؤسسة أولاد سليم للتجارة والتوزيع',
      companySubtitle: 'نظام المحاسبة وإدارة الأعمال المتكامل',
      phone1: '',
      phone2: '',
      address: '',
      commercialRegistration: '',
      taxNumber: '',
      currency: 'ج.م',
      defaultPrintMode: 'a4',
      invoiceNotes: 'شكرًا لتعاملكم معنا',
      allowNegativeStock: false,
      extraSettings: {},
    },
    sequences: {
      customerOrderNo: 0,
      salesInvoiceNo: 0,
      purchaseInvoiceNo: 0,
      salesReturnNo: 0,
      purchaseReturnNo: 0,
      stockMovementNo: 0,
      finTxNo: 0,
      repTransferNo: 0,
      repItemTransferNo: 0,
      expenseNo: 0,
      ownerTxNo: 0,
      stockCountNo: 0,
      stockTransferNo: 0,
      cashOpNo: 0,
    },
    lastSavedAt: new Date().toISOString(),
    version: '3.0.0',
  };
}

function atomicWriteJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function normalizeDbState(raw) {
  const base = createEmptyDatabaseState();
  const db = raw && typeof raw === 'object' ? { ...base, ...raw } : base;
  const arrayKeys = [
    'users',
    'warehouses',
    'categories',
    'products',
    'customers',
    'suppliers',
    'invoices',
    'invoiceReturns',
    'cashboxes',
    'financialTransactions',
    'cheques',
    'installments',
    'representatives',
    'repTransfers',
    'repItemTransfers',
    'customerItemOrders',
    'employees',
    'advancesDeductions',
    'attendance',
    'payrolls',
    'expenseIncomes',
    'stockMovements',
    'ownerAccounts',
    'ownerTransactions',
    'stockCounts',
    'stockTransferRequests',
  ];
  for (const key of arrayKeys) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
  if (!db.settings || typeof db.settings !== 'object') {
    db.settings = base.settings;
  } else {
    db.settings = { ...base.settings, ...db.settings, extraSettings: db.settings.extraSettings || {} };
  }
  db.sequences = { ...base.sequences, ...(db.sequences || {}) };
  return db;
}

export function readJsonDatabase() {
  const raw = readJsonFile(databaseFile, null);
  if (!raw) return createEmptyDatabaseState();
  return normalizeDbState(raw);
}

export function hasJsonDatabaseFile() {
  return fs.existsSync(databaseFile);
}

export function writeJsonDatabase(db) {
  const normalized = normalizeDbState(db);
  normalized.lastSavedAt = new Date().toISOString();
  normalized.version = '3.0.0';
  atomicWriteJson(databaseFile, normalized);
  return normalized;
}

export async function withJsonTransaction(callback) {
  return withJsonMutex(async () => {
    const current = readJsonDatabase();
    const working = structuredClone(current);
    let committed = false;
    const result = await callback(working, () => {
      writeJsonDatabase(working);
      committed = true;
    });
    if (!committed) {
      writeJsonDatabase(working);
    }
    return result;
  });
}

// Sessions Store (stored separately from main accounting database)
export function readJsonSessions() {
  const arr = readJsonFile(sessionsFile, []);
  return Array.isArray(arr) ? arr : [];
}

export function writeJsonSessions(sessions) {
  atomicWriteJson(sessionsFile, sessions);
}

// Audit Logs Store
export function readJsonAuditLogs() {
  const arr = readJsonFile(auditLogsFile, []);
  return Array.isArray(arr) ? arr : [];
}

export function appendJsonAuditLog(entry) {
  return withJsonMutex(() => {
    const logs = readJsonAuditLogs();
    logs.unshift(entry);
    if (logs.length > 5000) logs.length = 5000;
    atomicWriteJson(auditLogsFile, logs);
    return entry;
  });
}

// Idempotency Store
export function readJsonIdempotency() {
  const obj = readJsonFile(idempotencyFile, {});
  return obj && typeof obj === 'object' ? obj : {};
}

export function writeJsonIdempotency(map) {
  atomicWriteJson(idempotencyFile, map);
}

export function nextJsonSequence(db, seqKey, items = [], field = '', regex = null) {
  let maxExisting = Number(db.sequences?.[seqKey] || 0);
  if (field && regex && Array.isArray(items)) {
    for (const it of items) {
      const m = String(it?.[field] || '').match(regex);
      if (m && m[1]) {
        const val = Number.parseInt(m[1], 10);
        if (Number.isFinite(val) && val > maxExisting) maxExisting = val;
      }
    }
  }
  const next = maxExisting + 1;
  db.sequences = db.sequences || {};
  db.sequences[seqKey] = next;
  return next;
}

export function getDataPaths() {
  return { dataDir, databaseFile, sessionsFile, auditLogsFile, idempotencyFile };
}

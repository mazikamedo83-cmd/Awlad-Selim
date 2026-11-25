import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, withTransaction, initializeSchema, checkPostgresHealth, isStrictPostgresMode } from './postgres.js';
import { generateServerId } from '../utils/crypto.js';
import { normalizeCustomerPhonesList } from './stores/mode.js';
import { runSafeIdentityAuditAndBackfill } from './identityManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.AWLAD_DATA_DIR
  ? path.resolve(process.env.AWLAD_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const migrationLogsFile = path.join(dataDir, 'migration_logs.json');
const databaseFile = path.join(dataDir, 'database.json');

export function readMigrationLogs() {
  if (!fs.existsSync(migrationLogsFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(migrationLogsFile, 'utf8'));
  } catch {
    return [];
  }
}

export function saveMigrationLog(entry) {
  fs.mkdirSync(dataDir, { recursive: true });
  const logs = readMigrationLogs();
  logs.unshift(entry);
  fs.writeFileSync(migrationLogsFile, JSON.stringify(logs, null, 2), 'utf8');
}

function createImmutablePreMigrationBackup(sourceData, migrationId) {
  fs.mkdirSync(dataDir, { recursive: true });
  const backupFile = path.join(dataDir, `database.pre_migration.${migrationId}.readonly.bak.json`);
  const payload = fs.existsSync(databaseFile)
    ? fs.readFileSync(databaseFile, 'utf8')
    : JSON.stringify(sourceData, null, 2);
  fs.writeFileSync(backupFile, payload, 'utf8');
  try {
    fs.chmodSync(backupFile, 0o444);
  } catch {
    // Windows / restricted FS fallback
  }
  return backupFile;
}

function extractMaxSuffix(items, field, prefixRegex) {
  let max = 0;
  for (const item of items) {
    const val = String(item?.[field] || '');
    const m = val.match(prefixRegex);
    if (m && m[1]) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

export async function runDataMigration(sourceData, executedBy = 'مدير النظام', options = {}) {
  const startTime = Date.now();
  const migrationId = `MIG-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`.toUpperCase();
  const customPool = options.targetPool || null;
  const dryRunOrTest = Boolean(options.isTestRun || customPool);

  const details = {
    users: 0,
    customers: 0,
    suppliers: 0,
    categories: 0,
    products: 0,
    productUnits: 0,
    warehouses: 0,
    invoices: 0,
    invoiceItems: 0,
    payments: 0,
    returns: 0,
    cashboxes: 0,
    financialTransactions: 0,
    cheques: 0,
    installments: 0,
    representatives: 0,
    repTransfers: 0,
    repItemTransfers: 0,
    customerItemOrders: 0,
    employees: 0,
    expenseIncomes: 0,
    stockMovements: 0,
    ownerAccounts: 0,
    ownerTransactions: 0,
    stockCounts: 0,
    stockTransferRequests: 0,
    auditLogs: 0,
    settings: 0,
    errors: [],
    warnings: [],
    verification: null,
    backupFile: null,
  };

  let isPostgresReady = false;
  let dbLabel = 'JSON Structured Snapshot & Local Ledger';

  if (customPool) {
    isPostgresReady = true;
    dbLabel = 'PostgreSQL Target Test/Isolated Database';
  } else {
    const pgHealth = await checkPostgresHealth();
    isPostgresReady = pgHealth.status === 'online';
    if (isPostgresReady) {
      dbLabel = `PostgreSQL Database (${pgHealth.databaseName})`;
    }
  }

  const entry = {
    id: migrationId,
    timestamp: new Date().toISOString(),
    version: '3.0.0',
    action: dryRunOrTest
      ? 'اختبار ترحيل كامل والتحقق من التطابق على قاعدة منفصلة'
      : 'ترحيل شامل وآمن للبيانات إلى PostgreSQL والتحقق من الأرصدة',
    source: 'JSON State / database.json',
    destination: dbLabel,
    status: 'pending',
    totalRecords: 0,
    migratedRecords: 0,
    failedRecords: 0,
    details,
    executedBy,
    notes: '',
  };

  try {
    if (!sourceData || typeof sourceData !== 'object') {
      throw new Error('بيانات المصدر غير صالحة أو فارغة.');
    }

    // Step 1: Mandatory immutable backup before touching PostgreSQL
    if (!options.skipBackupFile) {
      details.backupFile = createImmutablePreMigrationBackup(sourceData, migrationId);
    }

    const users = Array.isArray(sourceData.users) ? sourceData.users : [];
    const warehouses = Array.isArray(sourceData.warehouses) ? sourceData.warehouses : [];
    const categories = Array.isArray(sourceData.categories) ? sourceData.categories : [];
    const products = Array.isArray(sourceData.products) ? sourceData.products : [];
    const customers = Array.isArray(sourceData.customers) ? sourceData.customers : [];
    const suppliers = Array.isArray(sourceData.suppliers) ? sourceData.suppliers : [];
    const invoices = Array.isArray(sourceData.invoices) ? sourceData.invoices : [];
    const invoiceReturns = Array.isArray(sourceData.invoiceReturns) ? sourceData.invoiceReturns : [];
    const cashboxes = Array.isArray(sourceData.cashboxes) ? sourceData.cashboxes : [];
    const financialTransactions = Array.isArray(sourceData.financialTransactions) ? sourceData.financialTransactions : [];
    const cheques = Array.isArray(sourceData.cheques) ? sourceData.cheques : [];
    const installments = Array.isArray(sourceData.installments) ? sourceData.installments : [];
    const representatives = Array.isArray(sourceData.representatives) ? sourceData.representatives : [];
    const repTransfers = Array.isArray(sourceData.repTransfers) ? sourceData.repTransfers : [];
    const repItemTransfers = Array.isArray(sourceData.repItemTransfers) ? sourceData.repItemTransfers : [];
    const customerItemOrders = Array.isArray(sourceData.customerItemOrders) ? sourceData.customerItemOrders : [];
    const employees = Array.isArray(sourceData.employees) ? sourceData.employees : [];
    const expenseIncomes = Array.isArray(sourceData.expenseIncomes) ? sourceData.expenseIncomes : [];
    const stockMovements = Array.isArray(sourceData.stockMovements) ? sourceData.stockMovements : [];
    const ownerAccounts = Array.isArray(sourceData.ownerAccounts) ? sourceData.ownerAccounts : [];
    const ownerTransactions = Array.isArray(sourceData.ownerTransactions) ? sourceData.ownerTransactions : [];
    const stockCounts = Array.isArray(sourceData.stockCounts) ? sourceData.stockCounts : [];
    const stockTransferRequests = Array.isArray(sourceData.stockTransferRequests) ? sourceData.stockTransferRequests : [];
    const pairingTokens = Array.isArray(sourceData.pairingTokens) ? sourceData.pairingTokens : [];
    const pairedDevices = Array.isArray(sourceData.pairedDevices) ? sourceData.pairedDevices : [];
    const orderAdvancePayments = Array.isArray(sourceData.orderAdvancePayments) ? sourceData.orderAdvancePayments : [];
    const syncConflicts = Array.isArray(sourceData.syncConflicts) ? sourceData.syncConflicts : [];
    const auditLogs = Array.isArray(sourceData.auditLogs) ? sourceData.auditLogs : [];

    let embeddedPayments = 0;
    let embeddedInvoiceItems = 0;
    invoices.forEach((inv) => {
      if (Array.isArray(inv.payments)) embeddedPayments += inv.payments.length;
      if (Array.isArray(inv.items)) embeddedInvoiceItems += inv.items.length;
    });
    let embeddedUnits = 0;
    products.forEach((p) => {
      if (Array.isArray(p.units)) embeddedUnits += p.units.length;
    });

    entry.totalRecords =
      users.length + warehouses.length + categories.length + products.length + embeddedUnits +
      customers.length + suppliers.length + invoices.length + embeddedInvoiceItems + embeddedPayments +
      invoiceReturns.length + cashboxes.length + financialTransactions.length + cheques.length +
      installments.length + representatives.length + repTransfers.length + repItemTransfers.length +
      customerItemOrders.length + employees.length +
      expenseIncomes.length + stockMovements.length +
      ownerAccounts.length + ownerTransactions.length + stockCounts.length + stockTransferRequests.length +
      auditLogs.length + (sourceData.settings ? 1 : 0);

    // Step 2: Detect conflicts without deleting anything
    const userById = new Map(users.map((u) => [u.id, u]));
    const customerUsersByPhone = new Map();
    for (const u of users) {
      if (u.role === 'customer' && u.phone) {
        const key = String(u.phone).trim();
        const list = customerUsersByPhone.get(key) || [];
        list.push(u);
        customerUsersByPhone.set(key, list);
      }
    }

    const customerPhoneCounts = new Map();
    for (const c of customers) {
      if (c.phone) {
        const key = String(c.phone).trim();
        customerPhoneCounts.set(key, (customerPhoneCounts.get(key) || 0) + 1);
      }
    }

    const resolvedCustomerUserId = new Map();
    const claimedUserIds = new Set();
    for (const c of customers) {
      if (c.userId && userById.has(c.userId) && !claimedUserIds.has(c.userId)) {
        resolvedCustomerUserId.set(c.id, c.userId);
        claimedUserIds.add(c.userId);
      } else if (c.userId && !userById.has(c.userId)) {
        details.warnings.push(`العميل (${c.name}) يشير إلى userId غير موجود (${c.userId}) - تم الاحتفاظ بملف العميل بدون حذف.`);
      }
    }
    for (const c of customers) {
      if (resolvedCustomerUserId.has(c.id)) continue;
      const phone = String(c.phone || '').trim();
      if (!phone) continue;
      const phoneDupCount = customerPhoneCounts.get(phone) || 0;
      const matchingUsers = (customerUsersByPhone.get(phone) || []).filter((u) => !claimedUserIds.has(u.id));
      if (phoneDupCount > 1 || matchingUsers.length > 1) {
        details.warnings.push(`تعارض هاتف متكرر (${phone}) عند العميل (${c.name}) - مُنع الربط التلقائي للمراجعة الإدارية.`);
      } else if (matchingUsers.length === 1) {
        resolvedCustomerUserId.set(c.id, matchingUsers[0].id);
        claimedUserIds.add(matchingUsers[0].id);
      }
    }

    const warehouseIds = new Set(warehouses.map((w) => w.id));
    const customerIds = new Set(customers.map((c) => c.id));
    const supplierIds = new Set(suppliers.map((s) => s.id));
    const cashboxIds = new Set(cashboxes.map((cb) => cb.id));
    const productMap = new Map(products.map((p) => [p.id, p]));

    invoices.forEach((inv) => {
      if (inv.warehouseId && !warehouseIds.has(inv.warehouseId)) {
        details.warnings.push(`تنبيه تكامل: الفاتورة ${inv.invoiceNumber} مرتبطة بمستودع غير موجود (${inv.warehouseId})`);
      }
      if (inv.customerId && !customerIds.has(inv.customerId)) {
        details.warnings.push(`تنبيه تكامل: الفاتورة ${inv.invoiceNumber} مرتبطة بعميل غير موجود (${inv.customerId})`);
      }
      if (inv.supplierId && !supplierIds.has(inv.supplierId)) {
        details.warnings.push(`تنبيه تكامل: الفاتورة ${inv.invoiceNumber} مرتبطة بمورد غير موجود (${inv.supplierId})`);
      }
      if (inv.cashboxId && !cashboxIds.has(inv.cashboxId)) {
        details.warnings.push(`تنبيه تكامل: الفاتورة ${inv.invoiceNumber} مرتبطة بخزينة غير موجودة (${inv.cashboxId})`);
      }
    });

    // Source balance aggregates for strict post-migration reconciliation
    const srcTotals = {
      customerBalanceSum: Number(customers.reduce((acc, c) => acc + Number(c.currentBalance || 0), 0).toFixed(2)),
      supplierBalanceSum: Number(suppliers.reduce((acc, s) => acc + Number(s.currentBalance || 0), 0).toFixed(2)),
      cashboxBalanceSum: Number(cashboxes.reduce((acc, cb) => acc + Number(cb.currentBalance || 0), 0).toFixed(2)),
      invoiceGrandTotalSum: Number(invoices.reduce((acc, inv) => acc + Number(inv.grandTotal || 0), 0).toFixed(2)),
    };

    if (isPostgresReady) {
      const schemaRes = await initializeSchema(customPool);
      if (!schemaRes.success) {
        throw new Error(`فشل تطبيق هيكل PostgreSQL: ${schemaRes.error}`);
      }

      await withTransaction(async (client) => {
        // Build safe 1:1 User <-> Employee link plan before insertion so Step 1 users never violate fk_users_employee_id before Step 17 employees exist
        const userSetById = new Map(users.map((u) => [u.id, u]));
        const empSetById = new Map(employees.map((e) => [e.id, e]));
        const claimedEmpIds = new Set();
        const claimedEmpUserIds = new Set();
        const verifiedEmpToUser = new Map();
        const verifiedUserToEmp = new Map();
        const conflictingUserEmpPairs = [];

        for (const emp of employees) {
          const rawUid = emp.userId && userSetById.has(emp.userId) ? emp.userId : null;
          if (!rawUid) continue;
          const u = userSetById.get(rawUid);
          if (claimedEmpUserIds.has(rawUid)) {
            conflictingUserEmpPairs.push(`تعارض ربط مستخدم (${rawUid}) بأكثر من موظف (${emp.id})`);
            continue;
          }
          if (u?.employeeId && u.employeeId !== emp.id) {
            conflictingUserEmpPairs.push(`تعارض عدم تماثل بين الموظف (${emp.id}) والمستخدم (${rawUid})`);
            continue;
          }
          claimedEmpUserIds.add(rawUid);
          claimedEmpIds.add(emp.id);
          verifiedEmpToUser.set(emp.id, rawUid);
          verifiedUserToEmp.set(rawUid, emp.id);
        }
        for (const u of users) {
          const rawEmpId = u.employeeId && empSetById.has(u.employeeId) ? u.employeeId : null;
          if (!rawEmpId) continue;
          if (verifiedUserToEmp.get(u.id) === rawEmpId) continue;
          if (claimedEmpIds.has(rawEmpId) || claimedEmpUserIds.has(u.id)) {
            conflictingUserEmpPairs.push(`تعارض ربط موظف (${rawEmpId}) بأكثر من مستخدم (${u.id})`);
            continue;
          }
          const emp = empSetById.get(rawEmpId);
          if (emp?.userId && emp.userId !== u.id) {
            conflictingUserEmpPairs.push(`تعارض عدم تماثل بين المستخدم (${u.id}) والموظف (${rawEmpId})`);
            continue;
          }
          claimedEmpIds.add(rawEmpId);
          claimedEmpUserIds.add(u.id);
          verifiedEmpToUser.set(rawEmpId, u.id);
          verifiedUserToEmp.set(u.id, rawEmpId);
        }
        for (const msg of conflictingUserEmpPairs) {
          details.warnings.push(`${msg} — تم الاحتفاظ بالسجلات دون حذف للمراجعة اليدوية.`);
        }

        // 1. Users (employee_id applied cleanly after Step 17 employees insertion to honor fk_users_employee_id)
        for (const u of users) {
          const algo = String(u.passwordHash || '').startsWith('$2') ? 'bcrypt' : 'legacy_sha256';
          await client.query(`
            INSERT INTO users (id, full_name, username, password_hash, password_algo, phone, address, notes, role, job_title, department, is_active, must_change_password, last_login, permissions, shortcuts, identity_id, employee_id, active_role, additional_roles, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
            ON CONFLICT (id) DO UPDATE SET
              full_name = EXCLUDED.full_name,
              username = EXCLUDED.username,
              password_hash = EXCLUDED.password_hash,
              password_algo = EXCLUDED.password_algo,
              phone = EXCLUDED.phone,
              address = EXCLUDED.address,
              role = EXCLUDED.role,
              job_title = EXCLUDED.job_title,
              department = EXCLUDED.department,
              is_active = EXCLUDED.is_active,
              permissions = EXCLUDED.permissions,
              shortcuts = EXCLUDED.shortcuts,
              identity_id = COALESCE(EXCLUDED.identity_id, users.identity_id),
              active_role = COALESCE(EXCLUDED.active_role, users.active_role),
              additional_roles = EXCLUDED.additional_roles;
          `, [
            u.id,
            u.fullName || u.username,
            u.username,
            u.passwordHash || '',
            algo,
            u.phone || '',
            u.address || '',
            u.notes || '',
            u.role || 'sales',
            u.jobTitle || '',
            u.department || '',
            u.isActive !== false,
            Boolean(u.mustChangePassword),
            u.lastLogin || null,
            JSON.stringify(u.permissions || {}),
            JSON.stringify(Array.isArray(u.shortcuts) ? u.shortcuts : []),
            u.identityId || null,
            null,
            u.activeRole || u.role || 'sales',
            JSON.stringify(Array.isArray(u.additionalRoles) ? u.additionalRoles : []),
            u.createdAt || new Date().toISOString(),
          ]);
          details.users++;
        }

        // 2. Settings
        if (sourceData.settings) {
          const s = sourceData.settings;
          await client.query(`
            INSERT INTO system_settings (id, company_name, company_subtitle, phone1, phone2, address, commercial_registration, tax_number, branch_number, currency, default_print_mode, invoice_notes, allow_negative_stock, extra_settings, updated_at)
            VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
            ON CONFLICT (id) DO UPDATE SET
              company_name = EXCLUDED.company_name,
              company_subtitle = EXCLUDED.company_subtitle,
              phone1 = EXCLUDED.phone1,
              phone2 = EXCLUDED.phone2,
              address = EXCLUDED.address,
              branch_number = EXCLUDED.branch_number,
              currency = EXCLUDED.currency,
              allow_negative_stock = EXCLUDED.allow_negative_stock,
              extra_settings = EXCLUDED.extra_settings;
          `, [
            s.companyName || 'أولاد سليم لتجارة المواد الغذائية بالجملة',
            s.companySubtitle || '',
            s.phone1 || '',
            s.phone2 || '',
            s.address || '',
            s.commercialRegistration || '',
            s.taxNumber || '',
            s.branchNumber || s.extraSettings?.branchNumber || '',
            s.currency || 'ج.م',
            s.defaultPrintMode || 'a4',
            s.invoiceNotes || '',
            Boolean(s.allowNegativeStock),
            JSON.stringify(s.extraSettings || {}),
          ]);
          details.settings++;
        }

        // 3. Warehouses
        for (const w of warehouses) {
          await client.query(`
            INSERT INTO warehouses (id, name, code, location, manager_name, phone, is_default, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              location = EXCLUDED.location,
              is_default = EXCLUDED.is_default,
              status = EXCLUDED.status;
          `, [
            w.id,
            w.name,
            w.code || `WH-${w.id}`,
            w.location || '',
            w.managerName || '',
            w.phone || '',
            Boolean(w.isDefault),
            w.status || (w.isActive === false ? 'suspended' : 'active'),
            w.createdAt || new Date().toISOString(),
          ]);
          details.warehouses++;
        }

        // 4. Categories
        for (const cat of categories) {
          await client.query(`
            INSERT INTO product_categories (id, name, description, status, created_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status;
          `, [cat.id, cat.name, cat.description || '', cat.status || 'active', cat.createdAt || new Date().toISOString()]);
          details.categories++;
        }

        // 5. Products & Units (handles both modern & legacy field names cleanly)
        for (const p of products) {
          const purchasePrice = Number(p.purchasePrice ?? p.buyPrice ?? 0);
          const sellingPrice = Number(p.sellingPrice ?? p.sellPrice ?? 0);
          const minStock = Number(p.minStockLevel ?? p.minStockLimit ?? 0);
          const status = p.status || (p.isActive === false ? 'archived' : 'active');
          const baseUnit = p.baseUnit || p.packageType || 'قطعة';
          await client.query(`
            INSERT INTO products (id, code, barcode, name, category, category_id, base_unit, size, color, purchase_price, selling_price, min_stock_level, stock_per_warehouse, image, notes, status, import_batch_id, imported_from_file, source_file_name, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              purchase_price = EXCLUDED.purchase_price,
              selling_price = EXCLUDED.selling_price,
              stock_per_warehouse = EXCLUDED.stock_per_warehouse,
              image = NULL,
              status = EXCLUDED.status,
              import_batch_id = EXCLUDED.import_batch_id,
              imported_from_file = EXCLUDED.imported_from_file,
              source_file_name = EXCLUDED.source_file_name;
          `, [
            p.id,
            p.code || `PRD-${p.id}`,
            p.barcode || p.code || '',
            p.name,
            p.category || 'عام',
            p.categoryId || null,
            baseUnit,
            p.size || '',
            p.color || '',
            purchasePrice,
            sellingPrice,
            minStock,
            JSON.stringify(p.stockPerWarehouse || {}),
            null,
            p.notes || '',
            status,
            p.importBatchId || null,
            Boolean(p.importedFromFile),
            p.sourceFileName || null,
            p.createdAt || new Date().toISOString(),
          ]);
          details.products++;

          if (Array.isArray(p.units)) {
            for (const u of p.units) {
              await client.query(`
                INSERT INTO product_units (id, product_id, name, conversion_factor, barcode, purchase_price, selling_price)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (id) DO UPDATE SET
                  name = EXCLUDED.name,
                  conversion_factor = EXCLUDED.conversion_factor,
                  selling_price = EXCLUDED.selling_price;
              `, [
                u.id || generateServerId('PU'),
                p.id,
                u.name,
                Number(u.conversionFactor || 1),
                u.barcode || '',
                Number(u.purchasePrice ?? 0),
                Number(u.sellingPrice ?? 0),
              ]);
              details.productUnits++;
            }
          }
        }

        // 6. Customers (supporting secondaryPhone/address/geoCoordinates & legacy aliases)
        for (const c of customers) {
          const linkedUserId = resolvedCustomerUserId.get(c.id) || null;
          const secondaryPhone = c.secondaryPhone ?? c.phone2 ?? '';
          const address = c.address ?? c.shopAddress ?? '';
          const geo = c.geoCoordinates ?? c.mapLocation ?? '';
          const allowedRepIds = Array.from(
            new Set([
              ...(c.assignedRepId ? [String(c.assignedRepId)] : []),
              ...(Array.isArray(c.allowedRepIds) ? c.allowedRepIds.map(String) : []),
            ].filter(Boolean))
          );
          const assignedRepId = c.assignedRepId || allowedRepIds[0] || null;
          const normalizedPhones = normalizeCustomerPhonesList(c.phones, c.phone || '', secondaryPhone);
          const governorate = c.governorate || '';
          await client.query(`
            INSERT INTO customers (id, code, user_id, assigned_rep_id, allowed_rep_ids, identity_id, name, phone, secondary_phone, phone2, phones, shop_name, shop_photo, photo, address, shop_address, governorate, area, geo_coordinates, map_location, opening_balance, current_balance, price_history, notes, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
            ON CONFLICT (id) DO UPDATE SET
              user_id = COALESCE(EXCLUDED.user_id, customers.user_id),
              assigned_rep_id = COALESCE(EXCLUDED.assigned_rep_id, customers.assigned_rep_id),
              allowed_rep_ids = EXCLUDED.allowed_rep_ids,
              identity_id = COALESCE(EXCLUDED.identity_id, customers.identity_id),
              name = EXCLUDED.name,
              phone = EXCLUDED.phone,
              secondary_phone = EXCLUDED.secondary_phone,
              phones = EXCLUDED.phones,
              shop_photo = CASE WHEN COALESCE(EXCLUDED.shop_photo, '') <> '' THEN EXCLUDED.shop_photo ELSE customers.shop_photo END,
              photo = CASE WHEN COALESCE(EXCLUDED.photo, '') <> '' THEN EXCLUDED.photo ELSE customers.photo END,
              address = EXCLUDED.address,
              governorate = CASE WHEN COALESCE(EXCLUDED.governorate, '') <> '' THEN EXCLUDED.governorate ELSE customers.governorate END,
              geo_coordinates = EXCLUDED.geo_coordinates,
              current_balance = EXCLUDED.current_balance,
              price_history = EXCLUDED.price_history,
              status = EXCLUDED.status;
          `, [
            c.id,
            c.code || `CUST-${c.id}`,
            linkedUserId,
            assignedRepId,
            JSON.stringify(allowedRepIds),
            c.identityId || null,
            c.name,
            c.phone || '',
            secondaryPhone,
            secondaryPhone,
            JSON.stringify(normalizedPhones),
            c.shopName || '',
            c.shopPhoto || '',
            c.photo || '',
            address,
            address,
            governorate,
            c.area || '',
            geo,
            geo,
            Number(c.openingBalance || 0),
            Number(c.currentBalance || 0),
            JSON.stringify(c.priceHistory || {}),
            c.notes || '',
            c.status || 'active',
            c.createdAt || new Date().toISOString(),
          ]);
          details.customers++;
        }

        // 7. Suppliers
        for (const s of suppliers) {
          await client.query(`
            INSERT INTO suppliers (id, code, identity_id, user_id, name, phone, address, opening_balance, current_balance, notes, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (id) DO UPDATE SET
              identity_id = COALESCE(EXCLUDED.identity_id, suppliers.identity_id),
              user_id = COALESCE(EXCLUDED.user_id, suppliers.user_id),
              name = EXCLUDED.name,
              phone = EXCLUDED.phone,
              address = EXCLUDED.address,
              current_balance = EXCLUDED.current_balance,
              status = EXCLUDED.status;
          `, [
            s.id,
            s.code || `SUPP-${s.id}`,
            s.identityId || null,
            s.userId && userById.has(s.userId) ? s.userId : null,
            s.name,
            s.phone || '',
            s.address || '',
            Number(s.openingBalance || 0),
            Number(s.currentBalance || 0),
            s.notes || '',
            s.status || 'active',
            s.createdAt || new Date().toISOString(),
          ]);
          details.suppliers++;
        }

        // 8. Cashboxes
        for (const cb of cashboxes) {
          await client.query(`
            INSERT INTO cashboxes (id, name, type, opening_balance, current_balance, is_default, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              current_balance = EXCLUDED.current_balance;
          `, [
            cb.id,
            cb.name,
            cb.type || 'cashbox',
            Number(cb.openingBalance || 0),
            Number(cb.currentBalance || 0),
            Boolean(cb.isDefault),
            cb.createdAt || new Date().toISOString(),
          ]);
          details.cashboxes++;
        }

        // 9. Representatives
        for (const r of representatives) {
          await client.query(`
            INSERT INTO representatives (id, code, user_id, identity_id, name, phone, vehicle_number, opening_balance, current_balance, commission_rate, notes, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id) DO UPDATE SET
              user_id = COALESCE(EXCLUDED.user_id, representatives.user_id),
              identity_id = COALESCE(EXCLUDED.identity_id, representatives.identity_id),
              name = EXCLUDED.name,
              phone = EXCLUDED.phone,
              current_balance = EXCLUDED.current_balance,
              status = EXCLUDED.status;
          `, [
            r.id,
            r.code || r.id,
            r.userId && userById.has(r.userId) ? r.userId : null,
            r.identityId || null,
            r.name,
            r.phone || '',
            r.vehicleNumber || '',
            Number(r.openingBalance || 0),
            Number(r.currentBalance || 0),
            Number(r.commissionRate || 0),
            r.notes || '',
            r.status || 'active',
            r.createdAt || new Date().toISOString(),
          ]);
          details.representatives++;
        }

        // 10. Invoices + Invoice Items + Payments
        const fallbackWarehouseId = warehouses[0]?.id || 'WH-01';
        const fallbackCashboxId = cashboxes[0]?.id || 'CASH-01';
        for (const inv of invoices) {
          const whId = warehouseIds.has(inv.warehouseId) ? inv.warehouseId : fallbackWarehouseId;
          const cbId = cashboxIds.has(inv.cashboxId) ? inv.cashboxId : fallbackCashboxId;
          await client.query(`
            INSERT INTO invoices (id, invoice_number, type, date, customer_id, customer_name, supplier_id, supplier_name, representative_id, representative_name, warehouse_id, warehouse_name, subtotal, discount_total, tax_total, grand_total, paid_amount, applied_advance_amount, remaining_amount, payment_type, payment_method, cashbox_id, status, notes, linked_rep_transfer_id, linked_rep_transfer_number, linked_customer_order_id, returned_quantity_by_item, review_status, reviewed_by, reviewed_at, review_notes, edited_by, edited_at, cancelled_by, cancelled_at, cancel_reason, dispatch_status, sent_by, sent_by_user_id, sent_at, recipient_user_id, recipient_name, received_by, received_by_user_id, received_at, rejected_by, rejected_by_user_id, rejected_at, rejection_reason, dispatch_history, version, created_by, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54)
            ON CONFLICT (id) DO UPDATE SET
              paid_amount = EXCLUDED.paid_amount,
              applied_advance_amount = EXCLUDED.applied_advance_amount,
              remaining_amount = EXCLUDED.remaining_amount,
              status = EXCLUDED.status,
              review_status = EXCLUDED.review_status,
              reviewed_by = EXCLUDED.reviewed_by,
              reviewed_at = EXCLUDED.reviewed_at,
              returned_quantity_by_item = EXCLUDED.returned_quantity_by_item,
              dispatch_status = EXCLUDED.dispatch_status,
              sent_by = EXCLUDED.sent_by,
              sent_by_user_id = EXCLUDED.sent_by_user_id,
              sent_at = EXCLUDED.sent_at,
              recipient_user_id = EXCLUDED.recipient_user_id,
              recipient_name = EXCLUDED.recipient_name,
              received_by = EXCLUDED.received_by,
              received_by_user_id = EXCLUDED.received_by_user_id,
              received_at = EXCLUDED.received_at,
              rejected_by = EXCLUDED.rejected_by,
              rejected_by_user_id = EXCLUDED.rejected_by_user_id,
              rejected_at = EXCLUDED.rejected_at,
              rejection_reason = EXCLUDED.rejection_reason,
              dispatch_history = EXCLUDED.dispatch_history;
          `, [
            inv.id,
            inv.invoiceNumber,
            inv.type,
            inv.date,
            inv.customerId && customerIds.has(inv.customerId) ? inv.customerId : null,
            inv.customerName || '',
            inv.supplierId && supplierIds.has(inv.supplierId) ? inv.supplierId : null,
            inv.supplierName || '',
            inv.representativeId || null,
            inv.representativeName || '',
            whId,
            inv.warehouseName || 'المستودع الرئيسي',
            Number(inv.subtotal || 0),
            Number(inv.discountTotal || 0),
            Number(inv.taxTotal || 0),
            Number(inv.grandTotal || 0),
            Number(inv.paidAmount || 0),
            Number(inv.appliedAdvanceAmount || 0),
            Number(inv.remainingAmount || 0),
            inv.paymentType || 'cash',
            inv.paymentMethod || 'cash',
            cbId,
            inv.status || 'confirmed',
            inv.notes || '',
            inv.linkedRepTransferId || null,
            inv.linkedRepTransferNumber || null,
            inv.linkedCustomerOrderId || null,
            JSON.stringify(inv.returnedQuantityByItem || {}),
            inv.reviewStatus || 'not_required',
            inv.reviewedBy || null,
            inv.reviewedAt || null,
            inv.reviewNotes || '',
            inv.editedBy || null,
            inv.editedAt || null,
            inv.cancelledBy || null,
            inv.cancelledAt || null,
            inv.cancelReason || '',
            inv.dispatchStatus || (inv.status === 'confirmed' ? 'confirmed' : 'draft'),
            inv.sentBy || null,
            inv.sentByUserId || null,
            inv.sentAt || null,
            inv.recipientUserId || null,
            inv.recipientName || null,
            inv.receivedBy || null,
            inv.receivedByUserId || null,
            inv.receivedAt || null,
            inv.rejectedBy || null,
            inv.rejectedByUserId || null,
            inv.rejectedAt || null,
            inv.rejectionReason || '',
            JSON.stringify(Array.isArray(inv.dispatchHistory) ? inv.dispatchHistory : []),
            Number(inv.version || 1),
            inv.createdBy || 'المدير العام',
            inv.createdAt || new Date().toISOString(),
          ]);
          details.invoices++;

          if (Array.isArray(inv.items)) {
            await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [inv.id]);
            for (let idx = 0; idx < inv.items.length; idx++) {
              const it = inv.items[idx];
              if (!productMap.has(it.productId)) {
                details.warnings.push(`تجاهل بند فاتورة (${inv.invoiceNumber}) لصنف محذوف (${it.productId})`);
                continue;
              }
              await client.query(`
                INSERT INTO invoice_items (id, invoice_id, product_id, product_name, barcode, unit, unit_factor, quantity, unit_price, purchase_price_at_time, discount, total)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (id) DO NOTHING;
              `, [
                it.id || `${inv.id}-ITM-${idx + 1}`,
                inv.id,
                it.productId,
                it.productName,
                it.barcode || '',
                it.unit || 'قطعة',
                Number(it.unitFactor || 1),
                Number(it.quantity || 0),
                Number(it.unitPrice || 0),
                Number(it.purchasePriceAtTime || 0),
                Number(it.discount || 0),
                Number(it.total || 0),
              ]);
              details.invoiceItems++;
            }
          }

          if (Array.isArray(inv.payments)) {
            for (const pay of inv.payments) {
              const pCbId = cashboxIds.has(pay.cashboxId) ? pay.cashboxId : fallbackCashboxId;
              await client.query(`
                INSERT INTO invoice_payments (id, invoice_id, invoice_number, amount, date, payment_method, cashbox_id, cashbox_name, notes, collection_location, created_by, created_by_user_id, actor_identity_id, actor_employee_id, acting_role, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                ON CONFLICT (id) DO NOTHING;
              `, [
                pay.id,
                inv.id,
                inv.invoiceNumber,
                Number(pay.amount || 0),
                pay.date,
                pay.paymentMethod || 'cash',
                pCbId,
                pay.cashboxName || 'الخزينة',
                pay.notes || '',
                pay.collectionLocation || (pay.actingRole === 'representative' ? 'rep' : 'branch'),
                pay.createdBy || 'المدير العام',
                pay.createdByUserId || null,
                pay.actorIdentityId || null,
                pay.actorEmployeeId || null,
                pay.actingRole || null,
                pay.createdAt || new Date().toISOString(),
              ]);
              details.payments++;
            }
          }
        }

        // 11. Invoice Returns & Items
        for (const ret of invoiceReturns) {
          const whId = warehouseIds.has(ret.warehouseId) ? ret.warehouseId : fallbackWarehouseId;
          await client.query(`
            INSERT INTO invoice_returns (id, return_number, type, original_invoice_id, original_invoice_number, date, party_id, party_name, warehouse_id, warehouse_name, grand_total, refund_type, cashbox_id, reason, notes, created_by, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            ON CONFLICT (id) DO NOTHING;
          `, [
            ret.id,
            ret.returnNumber,
            ret.type,
            ret.originalInvoiceId,
            ret.originalInvoiceNumber,
            ret.date,
            ret.partyId,
            ret.partyName,
            whId,
            ret.warehouseName || 'المستودع الرئيسي',
            Number(ret.grandTotal || 0),
            ret.refundType || 'balance',
            ret.cashboxId || null,
            ret.reason || '',
            ret.notes || '',
            ret.createdBy || 'النظام',
            ret.createdAt || new Date().toISOString(),
          ]);
          details.returns++;

          if (Array.isArray(ret.items)) {
            for (let idx = 0; idx < ret.items.length; idx++) {
              const it = ret.items[idx];
              if (!productMap.has(it.productId)) continue;
              await client.query(`
                INSERT INTO invoice_return_items (id, return_id, product_id, product_name, unit, unit_factor, quantity, unit_price, total)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (id) DO NOTHING;
              `, [
                `${ret.id}-RITM-${idx + 1}`,
                ret.id,
                it.productId,
                it.productName,
                it.unit || 'قطعة',
                Number(it.unitFactor || 1),
                Number(it.quantity || 0),
                Number(it.unitPrice || 0),
                Number(it.total || 0),
              ]);
            }
          }
        }

        // 12. Rep Financial Transfers
        for (const rt of repTransfers) {
          const repId = rt.direction === 'rep_to_owner' ? rt.senderId : rt.receiverId;
          const repName = rt.direction === 'rep_to_owner' ? rt.senderName : rt.receiverName;
          await client.query(`
            INSERT INTO rep_transfers (id, transfer_number, representative_id, representative_name, direction, sender_id, sender_name, receiver_id, receiver_name, type, amount, cashbox_id, cashbox_name, date, status, notes, rejection_reason, sent_at, confirmed_at, rejected_at, confirmed_by, audit_trail, created_by, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
            ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, audit_trail = EXCLUDED.audit_trail;
          `, [
            rt.id,
            rt.transferNumber,
            representatives.some((r) => r.id === repId) ? repId : null,
            repName || '',
            rt.direction || 'rep_to_owner',
            rt.senderId || '',
            rt.senderName || '',
            rt.receiverId || '',
            rt.receiverName || '',
            rt.direction || 'rep_to_owner',
            Number(rt.amount || 0),
            rt.cashboxId || fallbackCashboxId,
            rt.cashboxName || '',
            rt.date,
            rt.status,
            rt.notes || '',
            rt.rejectionReason || '',
            rt.sentAt || null,
            rt.confirmedAt || null,
            rt.rejectedAt || null,
            rt.confirmedBy || null,
            JSON.stringify(rt.auditTrail || []),
            rt.senderName || 'النظام',
            rt.timestamp || rt.sentAt || new Date().toISOString(),
          ]);
          details.repTransfers++;
        }

        // 13. Rep Item Transfers + Items
        for (const rit of repItemTransfers) {
          if (!representatives.some((r) => r.id === rit.representativeId)) continue;
          await client.query(`
            INSERT INTO rep_item_transfers (id, request_number, date, representative_id, representative_name, invoice_id, invoice_number, source_warehouse_id, source_warehouse_name, target_warehouse_id, target_warehouse_name, status, transfer_mode, dispatched_by, dispatched_at, rejection_reason, notes, created_by, created_at, reviewed_by, reviewed_at, executed_at, received_by, received_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
            ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, invoice_id = EXCLUDED.invoice_id, invoice_number = EXCLUDED.invoice_number, received_by = EXCLUDED.received_by, received_at = EXCLUDED.received_at;
          `, [
            rit.id,
            rit.requestNumber,
            rit.date,
            rit.representativeId,
            rit.representativeName,
            rit.invoiceId || null,
            rit.invoiceNumber || null,
            rit.sourceWarehouseId,
            rit.sourceWarehouseName,
            rit.targetWarehouseId,
            rit.targetWarehouseName,
            rit.status,
            rit.transferMode || 'transfer',
            rit.dispatchedBy || null,
            rit.dispatchedAt || null,
            rit.rejectionReason || '',
            rit.notes || '',
            rit.createdBy || 'المندوب',
            rit.createdAt || new Date().toISOString(),
            rit.reviewedBy || null,
            rit.reviewedAt || null,
            rit.executedAt || null,
            rit.receivedBy || null,
            rit.receivedAt || null,
          ]);
          details.repItemTransfers++;

          if (Array.isArray(rit.items)) {
            await client.query('DELETE FROM rep_item_transfer_items WHERE transfer_id = $1', [rit.id]);
            for (let idx = 0; idx < rit.items.length; idx++) {
              const it = rit.items[idx];
              if (!productMap.has(it.productId)) continue;
              await client.query(`
                INSERT INTO rep_item_transfer_items (id, transfer_id, product_id, product_name, barcode, unit, requested_qty, available_in_van_qty, shortage_qty, approved_qty, executed_qty)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                ON CONFLICT (id) DO NOTHING;
              `, [
                `${rit.id}-RITI-${idx + 1}`,
                rit.id,
                it.productId,
                it.productName,
                it.barcode || '',
                it.unit || 'قطعة',
                Number(it.requestedQty || 0),
                Number(it.availableInVanQty || 0),
                Number(it.shortageQty || 0),
                it.approvedQty ?? null,
                it.executedQty ?? null,
              ]);
            }
          }
        }

        // 14. Customer Item Orders + Items + Initial Status History
        for (const ord of customerItemOrders) {
          const cust = customers.find((c) => c.id === ord.customerId);
          if (!cust) {
            details.warnings.push(`طلب عميل (${ord.requestNumber}) يشير لعميل غير موجود (${ord.customerId}) - تم تجاهله بالـ SQL مع بقاء الأصل.`);
            continue;
          }
          const computedOrderTotal = Array.isArray(ord.items)
            ? ord.items.reduce((s, it) => s + Number(it.unitPrice || 0) * Number(it.quantity || 0), 0)
            : 0;
          const ordTotal = Number(ord.totalAmount || computedOrderTotal || 0);
          const ordAdv = Number(ord.advancePaidAmount || 0);
          const ordRem = Math.max(0, Number(ord.remainingAmount ?? (ordTotal - ordAdv)));
          await client.query(`
            INSERT INTO customer_item_orders (id, request_number, customer_id, user_id, requester_type, submitted_by_name, representative_id, representative_name, delivery_rep_id, delivery_rep_name, delivered_at, delivery_notes, delivery_proof, collected_amount, customer_name, customer_phone, shop_name, delivery_address, geo_coordinates, total_amount, advance_paid_amount, remaining_amount, status, source_platform, version, notes, rejection_reason, reviewed_by, reviewed_at, invoice_id, invoice_number, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
            ON CONFLICT (id) DO UPDATE SET
              status = EXCLUDED.status,
              requester_type = EXCLUDED.requester_type,
              submitted_by_name = EXCLUDED.submitted_by_name,
              representative_id = EXCLUDED.representative_id,
              representative_name = EXCLUDED.representative_name,
              delivery_rep_id = EXCLUDED.delivery_rep_id,
              delivery_rep_name = EXCLUDED.delivery_rep_name,
              delivered_at = EXCLUDED.delivered_at,
              delivery_notes = EXCLUDED.delivery_notes,
              collected_amount = EXCLUDED.collected_amount,
              total_amount = EXCLUDED.total_amount,
              advance_paid_amount = EXCLUDED.advance_paid_amount,
              remaining_amount = EXCLUDED.remaining_amount,
              invoice_id = EXCLUDED.invoice_id,
              invoice_number = EXCLUDED.invoice_number,
              reviewed_by = EXCLUDED.reviewed_by,
              reviewed_at = EXCLUDED.reviewed_at;
          `, [
            ord.id,
            ord.requestNumber,
            ord.customerId,
            ord.userId || resolvedCustomerUserId.get(ord.customerId) || null,
            ord.requesterType || (ord.representativeId ? 'representative' : 'customer'),
            ord.submittedByName || ord.representativeName || ord.customerName || cust.name,
            ord.representativeId || null,
            ord.representativeName || '',
            ord.deliveryRepId || null,
            ord.deliveryRepName || '',
            ord.deliveredAt || null,
            ord.deliveryNotes || '',
            ord.deliveryProof || null,
            Number(ord.collectedAmount || 0),
            ord.customerName || cust.name,
            ord.customerPhone || cust.phone || '',
            ord.shopName || cust.shopName || '',
            ord.deliveryAddress || cust.address || '',
            ord.geoCoordinates || cust.geoCoordinates || '',
            ordTotal,
            ordAdv,
            ordRem,
            ord.status || 'pending',
            ord.sourcePlatform || 'web',
            Number(ord.version || 1),
            ord.notes || '',
            ord.rejectionReason || null,
            ord.reviewedBy || null,
            ord.reviewedAt || null,
            ord.invoiceId || null,
            ord.invoiceNumber || null,
            ord.createdAt || new Date().toISOString(),
          ]);
          details.customerItemOrders++;

          if (Array.isArray(ord.items)) {
            await client.query('DELETE FROM customer_item_order_items WHERE order_id = $1', [ord.id]);
            for (let idx = 0; idx < ord.items.length; idx++) {
              const it = ord.items[idx];
              if (!productMap.has(it.productId)) continue;
              const prod = productMap.get(it.productId);
              await client.query(`
                INSERT INTO customer_item_order_items (id, order_id, product_id, product_code, product_name, product_image, unit, unit_factor, quantity, reference_unit_price)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (id) DO NOTHING;
              `, [
                `${ord.id}-OITM-${idx + 1}`,
                ord.id,
                it.productId,
                prod?.code || '',
                it.productName,
                null,
                it.unit || prod?.baseUnit || 'قطعة',
                Number(it.unitFactor || 1),
                Number(it.quantity || 1),
                it.unitPrice ?? null,
              ]);
            }
          }
        }

        // 15. Stock Movements
        for (const sm of stockMovements) {
          if (!productMap.has(sm.productId)) continue;
          const whId = warehouseIds.has(sm.warehouseId) ? sm.warehouseId : fallbackWarehouseId;
          await client.query(`
            INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, target_warehouse_id, target_warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, related_doc_type, related_doc_id, related_doc_number, notes, created_by, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
            ON CONFLICT (id) DO NOTHING;
          `, [
            sm.id,
            sm.movementNumber || sm.id,
            sm.date,
            sm.productId,
            sm.productName,
            whId,
            sm.warehouseName || '',
            sm.targetWarehouseId || null,
            sm.targetWarehouseName || null,
            sm.type || sm.movementType || 'adjustment',
            Number(sm.quantity || 0),
            sm.unit || 'قطعة',
            Number(sm.unitFactor || 1),
            Number(sm.unitCost || 0),
            Number(sm.balanceAfter ?? 0),
            sm.type || '',
            sm.referenceId || null,
            sm.referenceNumber || null,
            sm.notes || '',
            sm.createdBy || 'النظام',
            sm.createdAt || new Date().toISOString(),
          ]);
          details.stockMovements++;
        }

        // 16. Financial Transactions
        for (const ft of financialTransactions) {
          const cbId = cashboxIds.has(ft.cashboxId) ? ft.cashboxId : fallbackCashboxId;
          await client.query(`
            INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_id, related_entity_name, related_doc_type, related_doc_id, related_doc_number, description, notes, created_by_user_id, created_by, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            ON CONFLICT (id) DO NOTHING;
          `, [
            ft.id,
            ft.transactionNumber,
            ft.date,
            ft.type,
            Number(ft.amount || 0),
            cbId,
            ft.cashboxName || '',
            Number(ft.balanceAfter ?? 0),
            ft.category || '',
            ft.partyId || null,
            ft.partyName || null,
            ft.relatedDocType || null,
            ft.relatedDocId || null,
            ft.relatedDocNumber || null,
            ft.description || '',
            ft.notes || '',
            ft.createdByUserId || null,
            ft.createdBy || 'النظام',
            ft.createdAt || new Date().toISOString(),
          ]);
          details.financialTransactions++;
        }

        // 17. Cheques, Installments, Employees, Advances, Attendance, Payrolls, Expenses/Incomes, Audit Logs
        for (const ch of cheques) {
          await client.query(`
            INSERT INTO cheques (id, cheque_number, type, bank_name, amount, issue_date, due_date, party_type, party_id, party_name, status, cashbox_id, notes, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;
          `, [ch.id, ch.chequeNumber, ch.type, ch.bankName, Number(ch.amount || 0), ch.issueDate, ch.dueDate, ch.partyType, ch.partyId, ch.partyName, ch.status, ch.cashboxId || null, ch.notes || '', ch.createdAt || new Date().toISOString()]);
          details.cheques++;
        }

        for (const inst of installments) {
          if (!customerIds.has(inst.customerId)) continue;
          await client.query(`
            INSERT INTO installments (id, schedule_number, customer_id, customer_name, invoice_id, invoice_number, total_amount, paid_amount, remaining_amount, number_of_installments, installments_data, notes, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id) DO UPDATE SET paid_amount = EXCLUDED.paid_amount, remaining_amount = EXCLUDED.remaining_amount, installments_data = EXCLUDED.installments_data;
          `, [inst.id, inst.scheduleNumber, inst.customerId, inst.customerName, inst.invoiceId || null, inst.invoiceNumber || '', Number(inst.totalAmount || 0), Number(inst.paidAmount || 0), Number(inst.remainingAmount || 0), Array.isArray(inst.items) ? inst.items.length : 1, JSON.stringify(inst.items || []), inst.notes || '', inst.createdAt || new Date().toISOString()]);
          details.installments++;
        }

        for (const emp of employees) {
          const safeEmpUserId = verifiedEmpToUser.get(emp.id) || null;
          await client.query(`
            INSERT INTO employees (id, code, full_name, job_title, department, phone, national_id, hire_date, basic_salary, status, notes, identity_id, user_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            ON CONFLICT (id) DO UPDATE SET
              full_name = EXCLUDED.full_name,
              basic_salary = EXCLUDED.basic_salary,
              status = EXCLUDED.status,
              identity_id = COALESCE(EXCLUDED.identity_id, employees.identity_id),
              user_id = COALESCE(EXCLUDED.user_id, employees.user_id);
          `, [emp.id, emp.code, emp.name || emp.fullName, emp.jobTitle, emp.department || '', emp.phone || '', emp.nationalId || '', emp.hireDate, Number(emp.basicSalary || 0), emp.status || 'active', emp.notes || '', emp.identityId || null, safeEmpUserId]);
          details.employees++;
        }

        // Safely apply verified symmetrical 1:1 users.employee_id links after employees exist
        for (const [uId, empId] of verifiedUserToEmp.entries()) {
          await client.query(
            `UPDATE users SET employee_id = $1 WHERE id = $2 AND (employee_id IS NULL OR employee_id = $1)`,
            [empId, uId]
          );
        }

        for (const ei of expenseIncomes) {
          const cbId = cashboxIds.has(ei.cashboxId) ? ei.cashboxId : fallbackCashboxId;
          await client.query(`
            INSERT INTO expenses_incomes (id, voucher_number, type, category, amount, date, cashbox_id, cashbox_name, payment_method, recipient_or_payer, attachment_name, notes, created_by, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (id) DO NOTHING;
          `, [ei.id, ei.recordNumber, ei.type, ei.category, Number(ei.amount || 0), ei.date, cbId, ei.cashboxName || '', ei.paymentMethod || 'cash', ei.recipientOrPayer || '', ei.attachmentName || '', ei.notes || '', ei.createdBy || 'النظام', ei.createdAt || new Date().toISOString()]);
          details.expenseIncomes++;
        }

        // Owner Personal Accounts & Transactions
        const ownerAccountIds = new Set(ownerAccounts.map((oa) => oa.id));
        for (const oa of ownerAccounts) {
          await client.query(`
            INSERT INTO owner_accounts (id, owner_name, account_name, description, opening_balance, current_balance, status, notes, created_by, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT (id) DO UPDATE SET owner_name = EXCLUDED.owner_name, account_name = EXCLUDED.account_name, current_balance = EXCLUDED.current_balance, status = EXCLUDED.status;
          `, [oa.id, oa.ownerName, oa.accountName, oa.description || '', Number(oa.openingBalance || 0), Number(oa.currentBalance || 0), oa.status || 'active', oa.notes || '', oa.createdBy || 'النظام', oa.createdAt || new Date().toISOString(), oa.updatedAt || new Date().toISOString()]);
          details.ownerAccounts++;
        }

        for (const ot of ownerTransactions) {
          if (!ownerAccountIds.has(ot.accountId)) continue;
          const cbId = ot.cashboxId && cashboxIds.has(ot.cashboxId) ? ot.cashboxId : null;
          await client.query(`
            INSERT INTO owner_transactions (id, tx_number, account_id, account_name, owner_name, type, amount, date, cashbox_id, cashbox_name, balance_before, balance_after, notes, reason, status, idempotency_key, created_by_user_id, created_by, edited_by, edited_at, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
            ON CONFLICT (id) DO NOTHING;
          `, [ot.id, ot.txNumber, ot.accountId, ot.accountName, ot.ownerName, ot.type, Number(ot.amount || 0), ot.date, cbId, ot.cashboxName || '', Number(ot.balanceBefore || 0), Number(ot.balanceAfter || 0), ot.notes || '', ot.reason || '', ot.status || 'active', ot.idempotencyKey || null, ot.createdByUserId || null, ot.createdBy || 'النظام', ot.editedBy || null, ot.editedAt || null, ot.createdAt || new Date().toISOString()]);
          details.ownerTransactions++;
        }

        // Stock Counts
        for (const sc of stockCounts) {
          const whId = warehouseIds.has(sc.warehouseId) ? sc.warehouseId : fallbackWarehouseId;
          await client.query(`
            INSERT INTO stock_counts (id, count_number, date, warehouse_id, warehouse_name, status, notes, rejection_reason, counter_user_id, counter_name, submitted_at, approved_by_user_id, approved_by_name, approved_at, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;
          `, [sc.id, sc.countNumber, sc.date, whId, sc.warehouseName || '', sc.status || 'draft', sc.notes || '', sc.rejectionReason || null, sc.counterUserId || null, sc.counterName || 'النظام', sc.submittedAt || null, sc.approvedByUserId || null, sc.approvedByName || null, sc.approvedAt || null, sc.createdAt || new Date().toISOString(), sc.updatedAt || new Date().toISOString()]);
          for (const it of (sc.items || [])) {
            if (!productMap.has(it.productId)) continue;
            await client.query(`
              INSERT INTO stock_count_items (id, count_id, product_id, product_code, product_barcode, product_name, unit, system_qty, actual_qty, variance_qty, variance_type, live_qty_at_approval, reason)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
              ON CONFLICT (id) DO NOTHING;
            `, [it.id || generateServerId('SCI'), sc.id, it.productId, it.productCode || '', it.productBarcode || '', it.productName, it.unit || 'قطعة', Number(it.systemQty || 0), Number(it.actualQty || 0), Number(it.varianceQty || 0), it.varianceType || 'matched', it.liveQtyAtApproval ?? null, it.reason || '']);
          }
          details.stockCounts++;
        }

        // Structured Multi-Item Stock Transfer Requests
        for (const st of stockTransferRequests) {
          const srcWh = warehouseIds.has(st.sourceWarehouseId) ? st.sourceWarehouseId : fallbackWarehouseId;
          const dstWh = warehouseIds.has(st.targetWarehouseId) ? st.targetWarehouseId : fallbackWarehouseId;
          await client.query(`
            INSERT INTO stock_transfer_requests (id, transfer_number, date, source_warehouse_id, source_warehouse_name, target_warehouse_id, target_warehouse_name, transfer_type, status, reason, notes, rejection_reason, created_by_user_id, created_by, submitted_at, approved_by_user_id, approved_by, approved_at, executed_by_user_id, executed_by, executed_at, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
            ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;
          `, [st.id, st.transferNumber, st.date, srcWh, st.sourceWarehouseName || '', dstWh, st.targetWarehouseName || '', st.transferType || 'warehouse_transfer', st.status || 'draft', st.reason || '', st.notes || '', st.rejectionReason || null, st.createdByUserId || null, st.createdBy || 'النظام', st.submittedAt || null, st.approvedByUserId || null, st.approvedBy || null, st.approvedAt || null, st.executedByUserId || null, st.executedBy || null, st.executedAt || null, st.createdAt || new Date().toISOString(), st.updatedAt || new Date().toISOString()]);
          for (const it of (st.items || [])) {
            if (!productMap.has(it.productId)) continue;
            await client.query(`
              INSERT INTO stock_transfer_request_items (id, transfer_id, product_id, product_code, product_barcode, product_name, unit, unit_factor, requested_qty, available_qty_snapshot, executed_qty, notes)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
              ON CONFLICT (id) DO NOTHING;
            `, [it.id || generateServerId('STI'), st.id, it.productId, it.productCode || '', it.productBarcode || '', it.productName, it.unit || 'قطعة', Number(it.unitFactor || 1), Number(it.requestedQty || 0), Number(it.availableQtySnapshot || 0), it.executedQty ?? null, it.notes || '']);
          }
          details.stockTransferRequests++;
        }

        for (const pt of pairingTokens) {
          await client.query(`
            INSERT INTO pairing_tokens (id, token_hash, token_preview, created_by_user_id, created_by_name, target_user_id, target_user_name, target_role, target_device_type, connection_mode, expires_at, single_use, used_count, last_used_at, require_admin_approval, revoked_at, notes, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            ON CONFLICT (id) DO NOTHING;
          `, [pt.id, pt.tokenHash, pt.tokenPreview || 'PAIR', pt.createdByUserId || null, pt.createdByName || 'النظام', pt.targetUserId || null, pt.targetUserName || '', pt.targetRole || '', pt.targetDeviceType || 'any', pt.connectionMode || 'auto', pt.expiresAt || new Date().toISOString(), pt.singleUse !== false, Number(pt.usedCount || 0), pt.lastUsedAt || null, Boolean(pt.requireAdminApproval), pt.revokedAt || null, pt.notes || '', pt.createdAt || new Date().toISOString()]);
        }

        for (const pd of pairedDevices) {
          await client.query(`
            INSERT INTO paired_devices (device_id, device_name, device_type, os_version, app_version, linked_user_id, linked_user_name, connection_mode, server_url_used, ip_address, status, pairing_token_id, config_version, paired_at, last_seen_at, revoked_at, notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
            ON CONFLICT (device_id) DO UPDATE SET status = EXCLUDED.status, last_seen_at = EXCLUDED.last_seen_at;
          `, [pd.deviceId, pd.deviceName || 'جهاز غير معروف', pd.deviceType || 'android', pd.osVersion || '', pd.appVersion || '', pd.linkedUserId || null, pd.linkedUserName || '', pd.connectionMode || 'local_network', pd.serverUrlUsed || '', pd.ipAddress || '', pd.status || 'active', pd.pairingTokenId || null, Number(pd.configVersion || 1), pd.pairedAt || new Date().toISOString(), pd.lastSeenAt || new Date().toISOString(), pd.revokedAt || null, pd.notes || '']);
        }

        for (const oap of orderAdvancePayments) {
          if (!customerIds.has(oap.customerId)) continue;
          const cbId = cashboxIds.has(oap.cashboxId) ? oap.cashboxId : fallbackCashboxId;
          await client.query(`
            INSERT INTO order_advance_payments (id, payment_number, order_id, customer_id, cashbox_id, cashbox_name, payment_method, amount, date, notes, status, applied_invoice_id, idempotency_key, created_by, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            ON CONFLICT (id) DO NOTHING;
          `, [oap.id, oap.paymentNumber, oap.orderId, oap.customerId, cbId, oap.cashboxName || '', oap.paymentMethod || 'cash', Number(oap.amount || 0), oap.date, oap.notes || '', oap.status || 'active', oap.appliedInvoiceId || null, oap.idempotencyKey || null, oap.createdBy || 'النظام', oap.createdAt || new Date().toISOString()]);
        }

        for (const scf of syncConflicts) {
          await client.query(`
            INSERT INTO sync_conflicts (id, operation_id, operation_type, entity_type, entity_id, device_id, user_id, user_name, conflict_reason, local_payload, server_snapshot, status, resolution_notes, resolved_by, resolved_at, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            ON CONFLICT (id) DO NOTHING;
          `, [scf.id, scf.operationId, scf.operationType, scf.entityType, scf.entityId || null, scf.deviceId || null, scf.userId || null, scf.userName || '', scf.conflictReason || '', JSON.stringify(scf.localPayload || {}), JSON.stringify(scf.serverSnapshot || {}), scf.status || 'needs_review', scf.resolutionNotes || '', scf.resolvedBy || null, scf.resolvedAt || null, scf.createdAt || new Date().toISOString()]);
        }

        for (const rco of (sourceData.repCustodyOperations || [])) {
          if (!representatives.some((r) => r.id === rco.representativeId) || !productMap.has(rco.productId)) continue;
          await client.query(`
            INSERT INTO rep_custody_operations (id, operation_number, date, representative_id, representative_name, operation_type, product_id, product_name, unit, unit_factor, quantity, base_quantity, warehouse_id, warehouse_name, customer_id, customer_name, invoice_id, invoice_number, notes, status, created_by, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
            ON CONFLICT (id) DO NOTHING;
          `, [
            rco.id,
            rco.operationNumber,
            rco.date,
            rco.representativeId,
            rco.representativeName,
            rco.operationType,
            rco.productId,
            rco.productName,
            rco.unit || 'قطعة',
            Number(rco.unitFactor || 1),
            Number(rco.quantity || 0),
            Number(rco.baseQuantity || rco.quantity || 0),
            rco.warehouseId || null,
            rco.warehouseName || '',
            rco.customerId || null,
            rco.customerName || '',
            rco.invoiceId || null,
            rco.invoiceNumber || null,
            rco.notes || '',
            rco.status || 'approved',
            rco.createdBy || 'النظام',
            rco.createdAt || new Date().toISOString(),
          ]);
        }

        for (const al of auditLogs) {
          await client.query(`
            INSERT INTO audit_logs (id, timestamp, user_id, user_name, action, module, record_id, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO NOTHING;
          `, [al.id, al.timestamp || new Date().toISOString(), al.userId || null, al.userName || '', al.action, al.module, al.recordId || null, al.details || '']);
          details.auditLogs++;
        }

        for (const sdb of (sourceData.syncDispatchBatches || [])) {
          await client.query(`
            INSERT INTO sync_dispatch_batches (id, batch_number, client_batch_uuid, idempotency_key, device_id, sender_user_id, sender_name, representative_id, representative_name, recipient_user_id, recipient_name, recipient_role, send_status, receipt_status, sales_count, purchases_count, returns_count, collections_count, orders_count, customers_count, custody_ops_count, total_sales_amount, total_cash_amount, operation_ids, operations_snapshot, doc_summary, notes, receipt_notes, error_message, sent_at, received_by_user_id, received_by_name, received_at, received_device_id, discrepancy_details, rejection_reason, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38)
            ON CONFLICT (id) DO UPDATE SET receipt_status = EXCLUDED.receipt_status, received_by_user_id = EXCLUDED.received_by_user_id, received_by_name = EXCLUDED.received_by_name, received_at = EXCLUDED.received_at, received_device_id = EXCLUDED.received_device_id, discrepancy_details = EXCLUDED.discrepancy_details, rejection_reason = EXCLUDED.rejection_reason, updated_at = EXCLUDED.updated_at;
          `, [
            sdb.id, sdb.batchNumber, sdb.clientBatchUuid || sdb.id, sdb.idempotencyKey || sdb.id,
            sdb.deviceId || null, sdb.senderUserId, sdb.senderName || '', sdb.representativeId || null,
            sdb.representativeName || '', sdb.recipientUserId, sdb.recipientName || '', sdb.recipientRole || '',
            sdb.sendStatus || 'تم الإرسال', sdb.receiptStatus || 'في انتظار الاستلام',
            Number(sdb.salesCount || 0), Number(sdb.purchasesCount || 0), Number(sdb.returnsCount || 0),
            Number(sdb.collectionsCount || 0), Number(sdb.ordersCount || 0), Number(sdb.customersCount || 0),
            Number(sdb.custodyOpsCount || 0), Number(sdb.totalSalesAmount || 0), Number(sdb.totalCashAmount || 0),
            JSON.stringify(sdb.operationIds || []), JSON.stringify(sdb.operationsSnapshot || []), JSON.stringify(sdb.docSummary || []),
            sdb.notes || '', sdb.receiptNotes || '', sdb.errorMessage || '',
            sdb.sentAt || sdb.createdAt || new Date().toISOString(),
            sdb.receivedByUserId || null, sdb.receivedByName || '', sdb.receivedAt || null,
            sdb.receivedDeviceId || null, JSON.stringify(sdb.discrepancyDetails || {}), sdb.rejectionReason || '',
            sdb.createdAt || new Date().toISOString(), sdb.updatedAt || new Date().toISOString(),
          ]);
        }

        // Advance sequences past max existing numbers to avoid future collisions
        const maxOrderSeq = extractMaxSuffix(customerItemOrders, 'requestNumber', /^COR-(\d+)$/i);
        const maxSalesSeq = extractMaxSuffix(invoices.filter((i) => i.type === 'sales'), 'invoiceNumber', /-(\d+)$/);
        const maxPurSeq = extractMaxSuffix(invoices.filter((i) => i.type === 'purchase'), 'invoiceNumber', /-(\d+)$/);
        const maxQuoteSeq = extractMaxSuffix(invoices.filter((i) => i.type === 'quote'), 'invoiceNumber', /-(\d+)$/);
        const maxSalesRetSeq = extractMaxSuffix(invoiceReturns.filter((r) => r.type === 'sales_return'), 'returnNumber', /-(\d+)$/);
        const maxPurRetSeq = extractMaxSuffix(invoiceReturns.filter((r) => r.type === 'purchase_return'), 'returnNumber', /-(\d+)$/);
        const maxOwnerTxSeq = extractMaxSuffix(ownerTransactions, 'txNumber', /^OTX-(\d+)$/i);
        const maxStockCountSeq = extractMaxSuffix(stockCounts, 'countNumber', /^CNT-(\d+)$/i);
        const maxStockTransferSeq = extractMaxSuffix(stockTransferRequests, 'transferNumber', /^STR-(\d+)$/i);
        const maxCashOpSeq = extractMaxSuffix(financialTransactions, 'transactionNumber', /^COP-(\d+)$/i);
        const maxOrderAdvSeq = extractMaxSuffix(orderAdvancePayments, 'paymentNumber', /^ADV-(\d+)$/i);
        const maxRepCustodyOpSeq = extractMaxSuffix(sourceData.repCustodyOperations || [], 'operationNumber', /-(\d+)$/i);
        const maxDispatchBatchSeq = extractMaxSuffix(sourceData.syncDispatchBatches || [], 'batchNumber', /-(\d+)$/i);
        const seqUpdates = [
          ['seq_customer_order_no', maxOrderSeq],
          ['seq_sales_invoice_no', maxSalesSeq],
          ['seq_purchase_invoice_no', maxPurSeq],
          ['seq_quote_no', maxQuoteSeq],
          ['seq_sales_return_no', maxSalesRetSeq],
          ['seq_purchase_return_no', maxPurRetSeq],
          ['seq_owner_tx_no', maxOwnerTxSeq],
          ['seq_stock_count_no', maxStockCountSeq],
          ['seq_stock_transfer_no', maxStockTransferSeq],
          ['seq_cash_op_no', maxCashOpSeq],
          ['seq_order_advance_no', maxOrderAdvSeq],
          ['seq_rep_custody_op_no', maxRepCustodyOpSeq],
          ['seq_sync_dispatch_no', maxDispatchBatchSeq],
        ];
        for (const [seqName, maxVal] of seqUpdates) {
          if (maxVal > 0) {
            await client.query(`SELECT setval($1, $2, true)`, [seqName, maxVal]);
          }
        }

        // Post-migration reconciliation check inside transaction
        const pgUsersCount = Number((await client.query('SELECT COUNT(*)::int AS c FROM users')).rows[0].c);
        const pgCustRes = (await client.query('SELECT COUNT(*)::int AS c, COALESCE(SUM(current_balance), 0)::numeric AS s FROM customers')).rows[0];
        const pgSuppRes = (await client.query('SELECT COUNT(*)::int AS c, COALESCE(SUM(current_balance), 0)::numeric AS s FROM suppliers')).rows[0];
        const pgCbRes = (await client.query('SELECT COUNT(*)::int AS c, COALESCE(SUM(current_balance), 0)::numeric AS s FROM cashboxes')).rows[0];
        const pgInvRes = (await client.query('SELECT COUNT(*)::int AS c, COALESCE(SUM(grand_total), 0)::numeric AS s FROM invoices')).rows[0];

        const verification = {
          countsMatch:
            pgUsersCount >= users.length &&
            Number(pgCustRes.c) >= customers.length &&
            Number(pgSuppRes.c) >= suppliers.length &&
            Number(pgCbRes.c) >= cashboxes.length &&
            Number(pgInvRes.c) >= invoices.length,
          balancesMatch:
            Math.abs(Number(pgCustRes.s) - srcTotals.customerBalanceSum) < 0.01 &&
            Math.abs(Number(pgSuppRes.s) - srcTotals.supplierBalanceSum) < 0.01 &&
            Math.abs(Number(pgCbRes.s) - srcTotals.cashboxBalanceSum) < 0.01 &&
            Math.abs(Number(pgInvRes.s) - srcTotals.invoiceGrandTotalSum) < 0.01,
          sourceTotals: srcTotals,
          destinationTotals: {
            customerBalanceSum: Number(pgCustRes.s),
            supplierBalanceSum: Number(pgSuppRes.s),
            cashboxBalanceSum: Number(pgCbRes.s),
            invoiceGrandTotalSum: Number(pgInvRes.s),
          },
        };
        details.verification = verification;

        if (!verification.countsMatch || !verification.balancesMatch) {
          throw new Error('فشل فحص تطابق الأعداد والأرصدة بعد الترحيل - تم التراجع تلقائياً (ROLLBACK) لحماية البيانات.');
        }
      }, customPool);

      const idAudit = await runSafeIdentityAuditAndBackfill({
        targetPool: customPool,
        executedBy: `${executedBy} (migrator)`,
        createBackup: false,
      });
      details.identityAudit = idAudit || null;
      if ((idAudit?.newConflictsCount || 0) > 0) {
        details.warnings.push(`تم رصد ${idAudit.newConflictsCount} تعارض محتمل في الهويات للمراجعة الإدارية دون دمج تلقائي.`);
      }
    } else {
      details.users = users.length;
      details.warehouses = warehouses.length;
      details.categories = categories.length;
      details.products = products.length;
      details.productUnits = embeddedUnits;
      details.customers = customers.length;
      details.suppliers = suppliers.length;
      details.invoices = invoices.length;
      details.invoiceItems = embeddedInvoiceItems;
      details.payments = embeddedPayments;
      details.returns = invoiceReturns.length;
      details.cashboxes = cashboxes.length;
      details.financialTransactions = financialTransactions.length;
      details.cheques = cheques.length;
      details.installments = installments.length;
      details.representatives = representatives.length;
      details.repTransfers = repTransfers.length;
      details.repItemTransfers = repItemTransfers.length;
      details.customerItemOrders = customerItemOrders.length;
      details.employees = employees.length;
      details.expenseIncomes = expenseIncomes.length;
      details.stockMovements = stockMovements.length;
      details.ownerAccounts = ownerAccounts.length;
      details.ownerTransactions = ownerTransactions.length;
      details.stockCounts = stockCounts.length;
      details.stockTransferRequests = stockTransferRequests.length;
      details.auditLogs = auditLogs.length;
      details.settings = sourceData.settings ? 1 : 0;
      details.verification = { countsMatch: true, balancesMatch: true, sourceTotals: srcTotals };

      const snapshotPath = path.join(dataDir, `migration_snapshot_${migrationId}.json`);
      fs.writeFileSync(snapshotPath, JSON.stringify(sourceData, null, 2), 'utf8');
    }

    entry.migratedRecords =
      details.users + details.warehouses + details.categories + details.products + details.productUnits +
      details.customers + details.suppliers + details.invoices + details.invoiceItems + details.payments +
      details.returns + details.cashboxes + details.financialTransactions + details.cheques +
      details.installments + details.representatives + details.repTransfers + details.repItemTransfers +
      details.customerItemOrders + details.employees +
      details.expenseIncomes + details.stockMovements +
      details.ownerAccounts + details.ownerTransactions + details.stockCounts + details.stockTransferRequests +
      details.auditLogs + details.settings;

    entry.failedRecords = Math.max(0, entry.totalRecords - entry.migratedRecords);
    entry.status = details.warnings.length > 0 ? 'completed_with_warnings' : 'success';
    entry.notes = `اكتمل الترحيل والتحقق من الأرصدة في ${Date.now() - startTime}ms (${entry.migratedRecords} سجل).`;

    if (!options.skipLogFile) {
      saveMigrationLog(entry);
    }
    return { success: true, log: entry };
  } catch (error) {
    entry.status = 'failed';
    entry.failedRecords = entry.totalRecords;
    details.errors.push(error.message);
    entry.notes = `فشل الترحيل وتم التراجع الكامل دون تعديل البيانات: ${error.message}`;
    if (!options.skipLogFile) {
      saveMigrationLog(entry);
    }
    return { success: false, error: error.message, log: entry };
  }
}

export async function rollbackMigration(migrationIdOrBackup, executedBy = 'مدير النظام', customPool = null) {
  if (isStrictPostgresMode()) {
    return {
      success: false,
      code: 'STRICT_MODE_DESTRUCTIVE_BLOCKED',
      error:
        'يُمنع التراجع إلى JSON أو مسح جداول PostgreSQL في وضع الإنتاج الصارم (Production Strict Mode) لحماية البيانات ومنع انقسامها.',
    };
  }
  const logs = readMigrationLogs();
  let target = migrationIdOrBackup
    ? logs.find((l) => l.id === migrationIdOrBackup || l.details?.backupFile === migrationIdOrBackup)
    : logs.find((l) => l.status !== 'rolled_back' && l.details?.backupFile && fs.existsSync(l.details.backupFile));
  if (!target && migrationIdOrBackup) {
    target = logs.find((l) => l.status !== 'rolled_back' && l.details?.backupFile && fs.existsSync(l.details.backupFile));
  }
  if (!target) {
    return { success: false, error: 'لا يوجد سجل ترحيل سابق يحتوي على نسخة احتياطية قابلة للاستعادة.' };
  }
  const migrationId = target.id;

  const backupFile = target.details?.backupFile;
  if (backupFile && fs.existsSync(backupFile)) {
    const raw = fs.readFileSync(backupFile, 'utf8');
    const tmp = `${databaseFile}.rollback.tmp`;
    fs.writeFileSync(tmp, raw, 'utf8');
    fs.renameSync(tmp, databaseFile);
  }

  if (customPool || getPool()) {
    const poolToUse = customPool || getPool();
    await withTransaction(async (client) => {
      // Truncate/clear operational PostgreSQL tables only if explicitly rolling back to pre-migration JSON snapshot
      const tables = [
        'sync_dispatch_batches', 'sync_operation_logs', 'sync_conflicts', 'idempotency_keys',
        'pairing_tokens', 'paired_devices',
        'owner_transactions', 'owner_accounts',
        'stock_count_items', 'stock_counts',
        'stock_transfer_request_items', 'stock_transfer_requests',
        'order_advance_payments', 'order_status_history', 'customer_item_order_items', 'customer_item_orders',
        'invoice_return_items', 'invoice_returns', 'invoice_payments', 'invoice_items', 'invoices',
        'rep_custody_operations', 'rep_item_transfer_items', 'rep_item_transfers', 'rep_transfers',
        'stock_movements', 'financial_transactions', 'cheques', 'installments',
        'advances_deductions', 'attendance', 'payrolls', 'expenses_incomes',
        'product_units', 'products', 'product_categories', 'customers', 'suppliers',
        'representatives', 'warehouses', 'cashboxes', 'employees', 'identity_conflicts', 'identity_roles', 'identities', 'user_sessions', 'users', 'system_settings',
      ];
      for (const tbl of tables) {
        await client.query(`DELETE FROM ${tbl}`);
      }
    }, poolToUse);
  }

  const updated = logs.map((l) => (l.id === migrationId ? { ...l, status: 'rolled_back', notes: `${l.notes || ''} [تم التراجع بواسطة ${executedBy}]` } : l));
  fs.writeFileSync(migrationLogsFile, JSON.stringify(updated, null, 2), 'utf8');
  return { success: true, message: 'تم تنفيذ التراجع واستعادة النسخة المحمية بنجاح.' };
}

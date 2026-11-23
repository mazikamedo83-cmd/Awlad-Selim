import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePhoneDigits } from '../utils/errors.js';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pool = null;
let injectedPool = null;
let poolErrorNotifier = null;

export function setPgConnectionFailureListener(listener) {
  poolErrorNotifier = typeof listener === 'function' ? listener : null;
}

function notifyPgConnectionFailure(reason) {
  if (poolErrorNotifier) {
    try {
      poolErrorNotifier(reason);
    } catch {
      // ignore listener errors
    }
  }
}

export function isStrictPostgresMode() {
  if (process.env.AWLAD_REQUIRE_POSTGRES === 'true') return true;
  if (process.env.AWLAD_ELECTRON === 'true') return false;
  return process.env.NODE_ENV === 'production';
}

export function sanitizePgErrorMessage(rawMessage) {
  const msg = String(rawMessage || '');
  if (!msg) return '';
  return msg
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, 'postgresql://***:***@***')
    .replace(/(password\s*[=:]\s*)([^\s,;]+)/gi, '$1***');
}

const PG_CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '57P01',
  '57P02',
  '57P03',
  '57P04',
  '53300',
  'DATABASE_UNAVAILABLE',
]);

const PG_CONNECTION_ERROR_PATTERNS = [
  'connection terminated',
  'terminating connection',
  'connect econnrefused',
  'connection refused',
  'timeout exceeded',
  'client has encountered a connection error',
  'cannot use a pool after calling end',
  'pool is ending',
  'remaining connection slots',
  'server closed the connection unexpectedly',
  'the database system is starting up',
  'the database system is shutting down',
  'getaddrinfo enotfound',
  'socket hang up',
  'قاعدة بيانات postgresql غير متصلة',
];

export function isPgConnectionError(err, seen = new Set()) {
  if (!err || typeof err !== 'object' || seen.has(err)) return false;
  seen.add(err);

  const code = String(err.code || '').trim().toUpperCase();
  if (code && PG_CONNECTION_ERROR_CODES.has(code)) {
    return true;
  }

  const msg = String(err.message || '').toLowerCase();
  if (msg && PG_CONNECTION_ERROR_PATTERNS.some((pat) => msg.includes(pat))) {
    return true;
  }

  if (err.cause && isPgConnectionError(err.cause, seen)) {
    return true;
  }

  if (Array.isArray(err.errors)) {
    for (const inner of err.errors) {
      if (isPgConnectionError(inner, seen)) return true;
    }
  }

  return false;
}

export function setInjectedPool(customPool) {
  injectedPool = customPool || null;
}

export function isUsingInjectedPool() {
  return Boolean(injectedPool);
}

export function getPostgresConfig() {
  if (injectedPool) {
    return { injected: true };
  }

  const connectionString = (process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING || '').trim();
  if (connectionString) {
    return {
      connectionString,
      ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };
  }

  const host = (process.env.PGHOST || process.env.DB_HOST || '').trim();
  if (host) {
    return {
      host,
      port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
      user: (process.env.PGUSER || process.env.DB_USER || 'postgres').trim(),
      password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
      database: (process.env.PGDATABASE || process.env.DB_NAME || 'awlad_selim').trim(),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };
  }

  return null;
}

export function getPool() {
  if (injectedPool) return injectedPool;
  if (pool) return pool;
  const config = getPostgresConfig();
  if (!config) return null;

  try {
    pool = new Pool(config);
    pool.on('error', (err) => {
      notifyPgConnectionFailure(err?.code || 'pool_error');
      console.error('[PostgreSQL Pool Error]:', sanitizePgErrorMessage(err?.message));
    });
    return pool;
  } catch (error) {
    notifyPgConnectionFailure(error?.code || 'pool_init_error');
    console.error('[PostgreSQL Init Error]:', sanitizePgErrorMessage(error?.message));
    return null;
  }
}

export async function checkPostgresHealth() {
  const config = getPostgresConfig();
  if (!config) {
    return {
      configured: false,
      status: 'not_configured',
      message: isStrictPostgresMode()
        ? 'لم يتم ضبط إعدادات PostgreSQL المطلوبة لتشغيل وضع الإنتاج الصارم.'
        : 'لم يتم ضبط إعدادات PostgreSQL بعد. يعمل الخادم بقاعدة السجلات التسلسلية المؤمنة.',
    };
  }

  const currentPool = getPool();
  if (!currentPool) {
    return {
      configured: true,
      status: 'pool_failed',
      message: 'تعذر إنشاء حوض اتصال PostgreSQL.',
    };
  }

  const start = Date.now();
  try {
    const client = await currentPool.connect();
    try {
      const res = await client.query('SELECT NOW() AS server_time');
      let dbName = 'awlad_selim';
      let pgVersion = 'PostgreSQL';
      try {
        const metaRes = await client.query('SELECT current_database() AS db_name, version() AS pg_version');
        dbName = metaRes.rows[0]?.db_name || dbName;
        pgVersion = metaRes.rows[0]?.pg_version || pgVersion;
      } catch {
        // Lightweight PG-compatible engines (e.g., pg-mem) may omit current_database()/version()
      }
      const latency = Date.now() - start;
      return {
        configured: true,
        status: 'online',
        databaseName: dbName,
        timestamp: res.rows[0]?.server_time,
        version: pgVersion,
        latencyMs: latency,
        message: `متصل بقاعدة بيانات ${dbName} بنجاح (${latency}ms)`,
      };
    } finally {
      client.release();
    }
  } catch (err) {
    const safeError = sanitizePgErrorMessage(err?.message);
    return {
      configured: true,
      status: 'connection_failed',
      latencyMs: Date.now() - start,
      error: safeError,
      message: `فشل الاتصال بـ PostgreSQL: ${safeError}`,
    };
  }
}

export async function withTransaction(callback, customPool = null) {
  const currentPool = customPool || getPool();
  if (!currentPool) {
    const err = new Error('قاعدة بيانات PostgreSQL غير متصلة.');
    err.code = 'DATABASE_UNAVAILABLE';
    throw err;
  }

  let client;
  try {
    client = await currentPool.connect();
  } catch (error) {
    if (isPgConnectionError(error)) {
      notifyPgConnectionFailure(error?.code || 'connect_error');
    }
    throw error;
  }
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (isPgConnectionError(error)) {
      notifyPgConnectionFailure(error?.code || 'transaction_error');
    }
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function initializeSchema(customPool = null) {
  const currentPool = customPool || getPool();
  if (!currentPool) return { success: false, error: 'قاعدة بيانات PostgreSQL غير مهيأة' };

  const schemaPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    return { success: false, error: 'ملف schema.sql غير موجود' };
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');
  try {
    let alreadyHasV3Schema = false;
    try {
      const checkRes = await currentPool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'idempotency_keys'"
      );
      alreadyHasV3Schema = Boolean(checkRes.rows && checkRes.rows.length > 0);
    } catch {
      alreadyHasV3Schema = false;
    }

    if (!alreadyHasV3Schema) {
      await currentPool.query(sql);
    }

    // Non-destructive column and v4 table upgrades for pre-existing PostgreSQL databases
    const alterStatements = [
      "CREATE SEQUENCE IF NOT EXISTS seq_owner_tx_no",
      "CREATE SEQUENCE IF NOT EXISTS seq_stock_count_no",
      "CREATE SEQUENCE IF NOT EXISTS seq_stock_transfer_no",
      "CREATE SEQUENCE IF NOT EXISTS seq_cash_op_no",
      "CREATE SEQUENCE IF NOT EXISTS seq_order_advance_no",
      "CREATE SEQUENCE IF NOT EXISTS seq_quote_no",
      "CREATE SEQUENCE IF NOT EXISTS seq_rep_custody_op_no",
      "CREATE SEQUENCE IF NOT EXISTS seq_purchase_return_req_no",
      "CREATE SEQUENCE IF NOT EXISTS seq_sales_return_req_no",
      "ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS extra_settings JSONB NOT NULL DEFAULT '{}'::jsonb",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_algo VARCHAR(24) NOT NULL DEFAULT 'bcrypt'",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT DEFAULT ''",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS shortcuts JSONB NOT NULL DEFAULT '[]'::jsonb",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS user_id VARCHAR(64)",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS secondary_phone VARCHAR(32)",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS geo_coordinates TEXT",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS photo TEXT",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS shop_photo TEXT",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
      "ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS description TEXT",
      "ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id VARCHAR(64)",
      "ALTER TABLE products ADD COLUMN IF NOT EXISTS image TEXT",
      "ALTER TABLE products ADD COLUMN IF NOT EXISTS import_batch_id VARCHAR(64)",
      "ALTER TABLE products ADD COLUMN IF NOT EXISTS imported_from_file BOOLEAN NOT NULL DEFAULT FALSE",
      "ALTER TABLE products ADD COLUMN IF NOT EXISTS source_file_name TEXT",
      "ALTER TABLE products ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1",
      "ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS applied_advance_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS linked_customer_order_id VARCHAR(64)",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS returned_quantity_by_item JSONB NOT NULL DEFAULT '{}'::jsonb",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128)",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS origin_device_id VARCHAR(64)",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sync_status VARCHAR(24) NOT NULL DEFAULT 'synced'",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
      "ALTER TABLE invoice_return_items ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(12, 3) NOT NULL DEFAULT 1.000",
      "ALTER TABLE representatives ADD COLUMN IF NOT EXISTS user_id VARCHAR(64)",
      "ALTER TABLE representatives ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(64)",
      "ALTER TABLE representatives ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00",
      "ALTER TABLE representatives ADD COLUMN IF NOT EXISTS current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00",
      "ALTER TABLE representatives ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00",
      "ALTER TABLE representatives ADD COLUMN IF NOT EXISTS notes TEXT",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS assigned_rep_id VARCHAR(64)",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS allowed_rep_ids JSONB NOT NULL DEFAULT '[]'::jsonb",
      "ALTER TABLE rep_item_transfers ADD COLUMN IF NOT EXISTS received_by VARCHAR(64)",
      "ALTER TABLE rep_item_transfers ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ",
      "ALTER TABLE invoices ALTER COLUMN payment_method TYPE VARCHAR(32)",
      "ALTER TABLE invoice_payments ALTER COLUMN payment_method TYPE VARCHAR(32)",
      "ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS device_id VARCHAR(64)",
      "ALTER TABLE pairing_tokens ADD COLUMN IF NOT EXISTS server_base_url TEXT DEFAULT ''",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS requester_type VARCHAR(24) NOT NULL DEFAULT 'customer'",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS submitted_by_name TEXT DEFAULT ''",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS representative_id VARCHAR(64)",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS representative_name TEXT DEFAULT ''",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS advance_paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS delivery_rep_id VARCHAR(64)",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS delivery_rep_name TEXT DEFAULT ''",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS delivery_notes TEXT DEFAULT ''",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS delivery_proof TEXT",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS collected_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS source_platform VARCHAR(24) NOT NULL DEFAULT 'web'",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS origin_device_id VARCHAR(64)",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS sync_status VARCHAR(24) NOT NULL DEFAULT 'synced'",
      "ALTER TABLE customer_item_order_items ADD COLUMN IF NOT EXISTS product_image TEXT",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS review_status VARCHAR(24) NOT NULL DEFAULT 'not_required'",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(64)",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS review_notes TEXT DEFAULT ''",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS edited_by VARCHAR(64)",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS edit_history JSONB NOT NULL DEFAULT '[]'::jsonb",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(64)",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancel_reason TEXT DEFAULT ''",
      "ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS balance_before NUMERIC(12, 3)",
      "ALTER TABLE rep_item_transfers ADD COLUMN IF NOT EXISTS transfer_mode VARCHAR(32) NOT NULL DEFAULT 'transfer'",
      "ALTER TABLE rep_item_transfers ADD COLUMN IF NOT EXISTS dispatched_by TEXT",
      "ALTER TABLE rep_item_transfers ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS governorate TEXT DEFAULT ''",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS phones JSONB NOT NULL DEFAULT '[]'::jsonb",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dispatch_status VARCHAR(24) NOT NULL DEFAULT 'draft'",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_by TEXT",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_by_user_id VARCHAR(64)",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recipient_user_id VARCHAR(64)",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS recipient_name TEXT",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS received_by TEXT",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS received_by_user_id VARCHAR(64)",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS rejected_by TEXT",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS rejected_by_user_id VARCHAR(64)",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS rejection_reason TEXT DEFAULT ''",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dispatch_history JSONB NOT NULL DEFAULT '[]'::jsonb",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS normalized_phone VARCHAR(32) DEFAULT ''",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS normalized_phone VARCHAR(32) DEFAULT ''",
      "ALTER TABLE representatives ADD COLUMN IF NOT EXISTS normalized_phone VARCHAR(32) DEFAULT ''",
      "ALTER TABLE customer_item_orders DROP CONSTRAINT IF EXISTS customer_item_orders_status_check",
      "ALTER TABLE customer_item_orders ADD CONSTRAINT customer_item_orders_status_check CHECK (status IN ('pending', 'under_review', 'approved', 'rejected', 'preparing', 'rep_assigned', 'out_for_delivery', 'delivered', 'needs_review', 'invoiced', 'collected', 'closed', 'cancelled'))",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(64)",
      "ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(64)",
      "ALTER TABLE invoice_returns ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(64)",
      "ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(64)",
      "ALTER TABLE financial_transactions ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(64)",
      "ALTER TABLE expenses_incomes ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(64)",
      "ALTER TABLE order_advance_payments ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(64)",
      "ALTER TABLE rep_custody_operations ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(64)",
    ];
    function isIdempotentDdlError(err, stmt = '') {
      const code = String(err?.code || '');
      if (['42701', '42P07', '42710'].includes(code)) return true;
      if (code === '42704' && /DROP\s+CONSTRAINT\s+IF\s+EXISTS/i.test(stmt)) return true;
      const msg = String(err?.message || '');
      if (!code && /already exists/i.test(msg) && /IF\s+NOT\s+EXISTS/i.test(stmt)) return true;
      // pg-mem throws NotSupported AST coverage errors when re-running IF NOT EXISTS DDL on existing objects
      if (!code && /pg-mem/i.test(msg) && /IF\s+NOT\s+EXISTS/i.test(stmt)) return true;
      return false;
    }

    for (const stmt of alterStatements) {
      try {
        await currentPool.query(stmt);
      } catch (err) {
        if (!isIdempotentDdlError(err, stmt)) {
          console.error('[postgres] Migration ALTER statement failed:', stmt, err);
          throw err;
        }
      }
    }

    // Ensure v4 tables exist even when upgrading an existing v3 PG DB
    const v4Check = await currentPool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'owner_accounts'"
    );
    const hasV4Tables = Boolean(v4Check.rows && v4Check.rows.length > 0);
    if (!hasV4Tables) {
      const v4Marker = '-- 34. الحسابات الشخصية';
      const idx = sql.indexOf(v4Marker);
      if (idx !== -1) {
        await currentPool.query(sql.slice(idx));
      }
    }

    // Ensure v5 pairing/device tables exist on pre-existing v4 PG DBs
    const v5Check = await currentPool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pairing_tokens'"
    );
    const hasV5PairingTables = Boolean(v5Check.rows && v5Check.rows.length > 0);
    if (!hasV5PairingTables) {
      const v5Marker = '-- 40. روابط الربط الذكي';
      const idx5 = sql.indexOf(v5Marker);
      if (idx5 !== -1) {
        await currentPool.query(sql.slice(idx5));
      }
    }

    // Ensure v6 order advance & sync conflict tables exist on pre-existing v5 PG DBs
    const v6Check = await currentPool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_advance_payments'"
    );
    const hasV6SyncTables = Boolean(v6Check.rows && v6Check.rows.length > 0);
    if (!hasV6SyncTables) {
      const v6Marker = '-- 41. الدفعات المقدمة لطلبات العملاء';
      const idx6 = sql.indexOf(v6Marker);
      if (idx6 !== -1) {
        await currentPool.query(sql.slice(idx6));
      }
    }

    // Ensure v7 rep_custody_operations table exists on pre-existing PG DBs
    const v7Check = await currentPool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rep_custody_operations'"
    );
    const hasV7CustodyTable = Boolean(v7Check.rows && v7Check.rows.length > 0);
    if (!hasV7CustodyTable) {
      const v7Marker = '-- 44. سجل عمليات عهدة المندوب';
      const idx7 = sql.indexOf(v7Marker);
      if (idx7 !== -1) {
        await currentPool.query(sql.slice(idx7));
      }
    }

    // Ensure v8 atomic bootstrap singleton table and composite report/phone indexes exist on pre-existing PG DBs
    const v8Statements = [
      `CREATE TABLE IF NOT EXISTS system_bootstrap_lock (
        id VARCHAR(32) PRIMARY KEY,
        admin_user_id VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      'CREATE INDEX IF NOT EXISTS idx_invoices_date_type ON invoices(date DESC, type)',
      'CREATE INDEX IF NOT EXISTS idx_invoices_rep_date ON invoices(representative_id, date DESC)',
      'CREATE INDEX IF NOT EXISTS idx_invoices_cashbox_date ON invoices(cashbox_id, date DESC)',
      'CREATE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number)',
      'CREATE INDEX IF NOT EXISTS idx_invoice_returns_party_date ON invoice_returns(party_id, date DESC)',
      'CREATE INDEX IF NOT EXISTS idx_fin_tx_cashbox_date ON financial_transactions(cashbox_id, date DESC)',
      'CREATE INDEX IF NOT EXISTS idx_stock_movements_prod_date ON stock_movements(product_id, date DESC)',
      'CREATE INDEX IF NOT EXISTS idx_rep_custody_ops_date_prod ON rep_custody_operations(date DESC, product_id)',
      'CREATE INDEX IF NOT EXISTS idx_users_role_norm_phone ON users(role, normalized_phone)',
      'CREATE INDEX IF NOT EXISTS idx_customers_norm_phone ON customers(normalized_phone)',
      'CREATE INDEX IF NOT EXISTS idx_reps_norm_phone ON representatives(normalized_phone)',
    ];
    for (const stmt of v8Statements) {
      try {
        await currentPool.query(stmt);
      } catch (err) {
        if (!isIdempotentDdlError(err, stmt)) {
          console.error('[postgres] v8 DDL statement failed:', stmt, err);
          throw err;
        }
      }
    }

    // Non-destructive normalized_phone backfill for pre-existing databases
    for (const tbl of ['users', 'customers', 'representatives']) {
      const pending = await currentPool.query(
        `SELECT id, phone FROM ${tbl} WHERE (normalized_phone IS NULL OR normalized_phone = '') AND phone IS NOT NULL AND phone <> ''`
      );
      for (const row of pending.rows || []) {
        const norm = normalizePhoneDigits(row.phone);
        if (norm) {
          await currentPool.query(`UPDATE ${tbl} SET normalized_phone = $1 WHERE id = $2`, [norm, row.id]);
        }
      }
    }

    // Check legacy duplicate phone entries before creating strict partial unique index
    const dupRes = await currentPool.query(
      `SELECT role, normalized_phone, COUNT(*) AS cnt
       FROM users
       WHERE role IN ('customer', 'representative') AND normalized_phone IS NOT NULL AND normalized_phone <> ''
       GROUP BY role, normalized_phone`
    );
    const dupRows = (dupRes.rows || []).filter((r) => Number(r.cnt || 0) > 1);
    if (dupRows.length > 0) {
      console.warn(
        '[postgres] Skipped idx_users_role_norm_phone_unique due to pre-existing duplicate role+normalized_phone rows:',
        dupRows
      );
    } else {
      try {
        await currentPool.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_role_norm_phone_unique ON users(role, normalized_phone) WHERE role IN ('customer', 'representative') AND normalized_phone <> ''`
        );
      } catch (err) {
        // pg-mem does not support WHERE clauses on CREATE UNIQUE INDEX in all versions; genuine PG errors must still throw
        const msg = String(err?.message || '');
        const isInMemoryPartialIndexLimit = !err?.code && /pg-mem|partial index|not supported|where/i.test(msg);
        if (!isInMemoryPartialIndexLimit && !isIdempotentDdlError(err, 'CREATE UNIQUE INDEX IF NOT EXISTS')) {
          console.error('[postgres] Failed to create idx_users_role_norm_phone_unique:', err);
          throw err;
        }
      }
    }

    // Ensure v9 purchase_return_requests tables and ownership/report indexes exist on pre-existing PG DBs
    const v9Statements = [
      `CREATE TABLE IF NOT EXISTS purchase_return_requests (
        id VARCHAR(64) PRIMARY KEY,
        request_number VARCHAR(64) UNIQUE NOT NULL,
        date DATE NOT NULL,
        original_invoice_id VARCHAR(64) NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
        original_invoice_number VARCHAR(64) NOT NULL,
        supplier_id VARCHAR(64) NOT NULL,
        supplier_name TEXT NOT NULL DEFAULT '',
        warehouse_id VARCHAR(64) NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
        warehouse_name TEXT NOT NULL DEFAULT '',
        representative_id VARCHAR(64),
        representative_name TEXT DEFAULT '',
        requested_by_user_id VARCHAR(64) NOT NULL,
        requested_by_name TEXT NOT NULL,
        grand_total NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
        refund_type VARCHAR(16) NOT NULL DEFAULT 'credit',
        cashbox_id VARCHAR(64),
        reason TEXT NOT NULL,
        notes TEXT DEFAULT '',
        status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
        reviewed_by_user_id VARCHAR(64),
        reviewed_by_name TEXT DEFAULT '',
        reviewed_at TIMESTAMPTZ,
        rejection_reason TEXT DEFAULT '',
        approved_return_id VARCHAR(64),
        approved_return_number VARCHAR(64),
        idempotency_key VARCHAR(128) UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS purchase_return_request_items (
        id VARCHAR(64) PRIMARY KEY,
        request_id VARCHAR(64) NOT NULL REFERENCES purchase_return_requests(id) ON DELETE CASCADE,
        product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        product_name TEXT NOT NULL,
        unit VARCHAR(32) NOT NULL,
        unit_factor NUMERIC(12, 3) NOT NULL DEFAULT 1.000,
        quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
        total NUMERIC(14, 2) NOT NULL DEFAULT 0.00
      )`,
      'CREATE INDEX IF NOT EXISTS idx_invoices_created_by_uid ON invoices(created_by_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_invoices_cust_type_status_date ON invoices(customer_id, type, status, date DESC, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_invoice_payments_created_by_uid ON invoice_payments(created_by_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_invoice_returns_created_by_uid ON invoice_returns(created_by_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_fin_tx_created_by_uid ON financial_transactions(created_by_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_stock_movements_created_by_uid ON stock_movements(created_by_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_rep_custody_created_by_uid ON rep_custody_operations(created_by_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_order_adv_created_by_uid ON order_advance_payments(created_by_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_expenses_incomes_created_by_uid ON expenses_incomes(created_by_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_pr_req_status ON purchase_return_requests(status, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_pr_req_rep ON purchase_return_requests(representative_id)',
      'CREATE INDEX IF NOT EXISTS idx_pr_req_user ON purchase_return_requests(requested_by_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_pr_req_inv ON purchase_return_requests(original_invoice_id)',
      'CREATE INDEX IF NOT EXISTS idx_pr_req_items_req ON purchase_return_request_items(request_id)',
    ];
    for (const stmt of v9Statements) {
      try {
        await currentPool.query(stmt);
      } catch (err) {
        if (!isIdempotentDdlError(err, stmt)) {
          console.error('[postgres] v9 DDL statement failed:', stmt, err);
          throw err;
        }
      }
    }

    // Conservative non-destructive backfill for created_by_user_id on pre-existing PG DBs
    const allUsersRes = await currentPool.query('SELECT id, full_name, username FROM users');
    const fullNameCounts = new Map();
    const uniqueUserByFullName = new Map();
    const userById = new Set();
    const userByUsername = new Map();
    for (const u of allUsersRes.rows || []) {
      userById.add(u.id);
      if (u.username) userByUsername.set(String(u.username).trim(), u.id);
      const fn = String(u.full_name || '').trim();
      if (fn) {
        fullNameCounts.set(fn, (fullNameCounts.get(fn) || 0) + 1);
        uniqueUserByFullName.set(fn, u.id);
      }
    }
    for (const [fn, cnt] of fullNameCounts.entries()) {
      if (cnt > 1) uniqueUserByFullName.delete(fn);
    }

    // Backfill invoices via sent_by_user_id / representative.user_id first (safe even with duplicate Arabic names)
    await currentPool.query(
      `UPDATE invoices SET created_by_user_id = sent_by_user_id
       WHERE created_by_user_id IS NULL AND sent_by_user_id IS NOT NULL`
    );
    const invRepBackfill = await currentPool.query(
      `SELECT i.id, r.user_id
       FROM invoices i
       JOIN representatives r ON r.id = i.representative_id
       WHERE i.created_by_user_id IS NULL
         AND r.user_id IS NOT NULL
         AND (i.created_by = r.name OR i.created_by = r.user_id)`
    );
    for (const row of invRepBackfill.rows || []) {
      await currentPool.query(
        `UPDATE invoices SET created_by_user_id = $1 WHERE id = $2 AND created_by_user_id IS NULL`,
        [row.user_id, row.id]
      );
    }

    const ownershipTables = [
      'invoices',
      'invoice_payments',
      'invoice_returns',
      'financial_transactions',
      'stock_movements',
      'expenses_incomes',
      'order_advance_payments',
      'rep_custody_operations',
    ];
    for (const tbl of ownershipTables) {
      const nullRes = await currentPool.query(
        `SELECT DISTINCT created_by FROM ${tbl} WHERE created_by_user_id IS NULL AND created_by IS NOT NULL AND created_by <> ''`
      );
      for (const row of nullRes.rows || []) {
        const cb = String(row.created_by || '').trim();
        let resolvedUserId = null;
        if (userById.has(cb)) {
          resolvedUserId = cb;
        } else if (uniqueUserByFullName.has(cb)) {
          resolvedUserId = uniqueUserByFullName.get(cb);
        } else if (userByUsername.has(cb)) {
          resolvedUserId = userByUsername.get(cb);
        }
        if (resolvedUserId) {
          await currentPool.query(
            `UPDATE ${tbl} SET created_by_user_id = $1 WHERE created_by_user_id IS NULL AND created_by = $2`,
            [resolvedUserId, row.created_by]
          );
        }
      }
    }

    // Verify required v9 columns & tables exist
    const colCheck = await currentPool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'invoices' AND column_name = 'created_by_user_id'`
    );
    if (!colCheck.rows || colCheck.rows.length === 0) {
      throw new Error('Verification failed: invoices.created_by_user_id column missing after schema init');
    }
    const tblCheck = await currentPool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'purchase_return_requests'`
    );
    if (!tblCheck.rows || tblCheck.rows.length === 0) {
      throw new Error('Verification failed: purchase_return_requests table missing after schema init');
    }

    // Ensure v10 sales_return_requests tables and indexes exist on pre-existing PG DBs
    const v10Statements = [
      `CREATE SEQUENCE IF NOT EXISTS seq_sales_return_req_no`,
      `CREATE TABLE IF NOT EXISTS sales_return_requests (
        id VARCHAR(64) PRIMARY KEY,
        request_number VARCHAR(64) UNIQUE NOT NULL,
        date DATE NOT NULL,
        original_invoice_id VARCHAR(64) NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
        original_invoice_number VARCHAR(64) NOT NULL,
        customer_id VARCHAR(64) NOT NULL,
        customer_name TEXT NOT NULL DEFAULT '',
        warehouse_id VARCHAR(64) NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
        warehouse_name TEXT NOT NULL DEFAULT '',
        representative_id VARCHAR(64),
        representative_name TEXT DEFAULT '',
        requested_by_user_id VARCHAR(64) NOT NULL,
        requested_by_name TEXT NOT NULL,
        grand_total NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
        refund_type VARCHAR(16) NOT NULL DEFAULT 'cash',
        cashbox_id VARCHAR(64),
        reason TEXT NOT NULL,
        notes TEXT DEFAULT '',
        status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
        reviewed_by_user_id VARCHAR(64),
        reviewed_by_name TEXT DEFAULT '',
        reviewed_at TIMESTAMPTZ,
        rejection_reason TEXT DEFAULT '',
        approved_return_id VARCHAR(64),
        approved_return_number VARCHAR(64),
        idempotency_key VARCHAR(128) UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS sales_return_request_items (
        id VARCHAR(64) PRIMARY KEY,
        request_id VARCHAR(64) NOT NULL REFERENCES sales_return_requests(id) ON DELETE CASCADE,
        product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        product_name TEXT NOT NULL,
        unit VARCHAR(32) NOT NULL,
        unit_factor NUMERIC(12, 3) NOT NULL DEFAULT 1.000,
        quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
        unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
        total NUMERIC(14, 2) NOT NULL DEFAULT 0.00
      )`,
      'CREATE INDEX IF NOT EXISTS idx_sr_req_status ON sales_return_requests(status, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_sr_req_rep ON sales_return_requests(representative_id)',
      'CREATE INDEX IF NOT EXISTS idx_sr_req_user ON sales_return_requests(requested_by_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_sr_req_inv ON sales_return_requests(original_invoice_id)',
      'CREATE INDEX IF NOT EXISTS idx_sr_req_items_req ON sales_return_request_items(request_id)',
    ];
    for (const stmt of v10Statements) {
      try {
        await currentPool.query(stmt);
      } catch (err) {
        if (!isIdempotentDdlError(err, stmt)) {
          console.error('[postgres] v10 DDL statement failed:', stmt, err);
          throw err;
        }
      }
    }

    const srTblCheck = await currentPool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'sales_return_requests'`
    );
    if (!srTblCheck.rows || srTblCheck.rows.length === 0) {
      throw new Error('Verification failed: sales_return_requests table missing after schema init');
    }

    // Ensure v11 Unified Identity tables, linking columns, actor tracking columns & indexes exist on pre-existing PG DBs
    const v11Statements = [
      `CREATE TABLE IF NOT EXISTS identities (
        id VARCHAR(64) PRIMARY KEY,
        identity_type VARCHAR(24) NOT NULL DEFAULT 'person' CHECK (identity_type IN ('person', 'organization')),
        full_name TEXT NOT NULL,
        primary_phone VARCHAR(32) DEFAULT '',
        normalized_phone VARCHAR(32) DEFAULT '',
        secondary_phone VARCHAR(32) DEFAULT '',
        national_id VARCHAR(64) DEFAULT '',
        commercial_reg VARCHAR(64) DEFAULT '',
        address TEXT DEFAULT '',
        status VARCHAR(24) NOT NULL DEFAULT 'active',
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS identity_roles (
        id VARCHAR(64) PRIMARY KEY,
        identity_id VARCHAR(64) NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
        role_key VARCHAR(32) NOT NULL,
        linked_record_type VARCHAR(32) NOT NULL CHECK (linked_record_type IN ('user', 'employee', 'representative', 'customer', 'supplier')),
        linked_record_id VARCHAR(64) NOT NULL,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        status VARCHAR(24) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(linked_record_type, linked_record_id),
        UNIQUE(identity_id, role_key)
      )`,
      `CREATE TABLE IF NOT EXISTS identity_conflicts (
        id VARCHAR(64) PRIMARY KEY,
        conflict_type VARCHAR(64) NOT NULL,
        severity VARCHAR(24) NOT NULL DEFAULT 'warning',
        identifier_key VARCHAR(128) DEFAULT '',
        candidate_records JSONB NOT NULL DEFAULT '[]'::jsonb,
        status VARCHAR(24) NOT NULL DEFAULT 'pending_review',
        resolution_notes TEXT DEFAULT '',
        resolved_by VARCHAR(64),
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_id VARCHAR(64)",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id VARCHAR(64)",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS active_role VARCHAR(32)",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS additional_roles JSONB NOT NULL DEFAULT '[]'::jsonb",
      "ALTER TABLE employees ADD COLUMN IF NOT EXISTS identity_id VARCHAR(64)",
      "ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_id VARCHAR(64)",
      "ALTER TABLE employees ADD COLUMN IF NOT EXISTS normalized_phone VARCHAR(32) DEFAULT ''",
      "ALTER TABLE customers ADD COLUMN IF NOT EXISTS identity_id VARCHAR(64)",
      "ALTER TABLE representatives ADD COLUMN IF NOT EXISTS identity_id VARCHAR(64)",
      "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS identity_id VARCHAR(64)",
      "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS user_id VARCHAR(64)",
      "ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS normalized_phone VARCHAR(32) DEFAULT ''",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS actor_identity_id VARCHAR(64)",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS actor_employee_id VARCHAR(64)",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS acting_role VARCHAR(32)",
      "ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS actor_identity_id VARCHAR(64)",
      "ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS actor_employee_id VARCHAR(64)",
      "ALTER TABLE invoice_payments ADD COLUMN IF NOT EXISTS acting_role VARCHAR(32)",
      "ALTER TABLE invoice_returns ADD COLUMN IF NOT EXISTS actor_identity_id VARCHAR(64)",
      "ALTER TABLE invoice_returns ADD COLUMN IF NOT EXISTS actor_employee_id VARCHAR(64)",
      "ALTER TABLE invoice_returns ADD COLUMN IF NOT EXISTS acting_role VARCHAR(32)",
      "ALTER TABLE financial_transactions ADD COLUMN IF NOT EXISTS actor_identity_id VARCHAR(64)",
      "ALTER TABLE financial_transactions ADD COLUMN IF NOT EXISTS actor_employee_id VARCHAR(64)",
      "ALTER TABLE financial_transactions ADD COLUMN IF NOT EXISTS acting_role VARCHAR(32)",
      "ALTER TABLE expenses_incomes ADD COLUMN IF NOT EXISTS actor_identity_id VARCHAR(64)",
      "ALTER TABLE expenses_incomes ADD COLUMN IF NOT EXISTS actor_employee_id VARCHAR(64)",
      "ALTER TABLE expenses_incomes ADD COLUMN IF NOT EXISTS acting_role VARCHAR(32)",
      "ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS actor_identity_id VARCHAR(64)",
      "ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS actor_employee_id VARCHAR(64)",
      "ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS acting_role VARCHAR(32)",
      "ALTER TABLE rep_custody_operations ADD COLUMN IF NOT EXISTS actor_identity_id VARCHAR(64)",
      "ALTER TABLE rep_custody_operations ADD COLUMN IF NOT EXISTS actor_employee_id VARCHAR(64)",
      "ALTER TABLE rep_custody_operations ADD COLUMN IF NOT EXISTS acting_role VARCHAR(32)",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS actor_identity_id VARCHAR(64)",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS actor_employee_id VARCHAR(64)",
      "ALTER TABLE customer_item_orders ADD COLUMN IF NOT EXISTS acting_role VARCHAR(32)",
      "ALTER TABLE order_advance_payments ADD COLUMN IF NOT EXISTS actor_identity_id VARCHAR(64)",
      "ALTER TABLE order_advance_payments ADD COLUMN IF NOT EXISTS actor_employee_id VARCHAR(64)",
      "ALTER TABLE order_advance_payments ADD COLUMN IF NOT EXISTS acting_role VARCHAR(32)",
      "ALTER TABLE rep_transfers ADD COLUMN IF NOT EXISTS actor_identity_id VARCHAR(64)",
      "ALTER TABLE rep_transfers ADD COLUMN IF NOT EXISTS actor_employee_id VARCHAR(64)",
      "ALTER TABLE rep_transfers ADD COLUMN IF NOT EXISTS acting_role VARCHAR(32)",
      "ALTER TABLE rep_item_transfers ADD COLUMN IF NOT EXISTS actor_identity_id VARCHAR(64)",
      "ALTER TABLE rep_item_transfers ADD COLUMN IF NOT EXISTS actor_employee_id VARCHAR(64)",
      "ALTER TABLE rep_item_transfers ADD COLUMN IF NOT EXISTS acting_role VARCHAR(32)",
      "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_identity_id VARCHAR(64)",
      "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_employee_id VARCHAR(64)",
      "ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS acting_role VARCHAR(32)",
      'CREATE INDEX IF NOT EXISTS idx_identities_norm_phone ON identities(normalized_phone)',
      'CREATE INDEX IF NOT EXISTS idx_identities_national_id ON identities(national_id)',
      'CREATE INDEX IF NOT EXISTS idx_identity_roles_identity ON identity_roles(identity_id)',
      'CREATE INDEX IF NOT EXISTS idx_identity_conflicts_status ON identity_conflicts(status, created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_users_identity ON users(identity_id)',
      'CREATE INDEX IF NOT EXISTS idx_users_employee ON users(employee_id)',
      'CREATE INDEX IF NOT EXISTS idx_employees_identity ON employees(identity_id)',
      'CREATE INDEX IF NOT EXISTS idx_employees_norm_phone ON employees(normalized_phone)',
      'CREATE INDEX IF NOT EXISTS idx_customers_identity ON customers(identity_id)',
      'CREATE INDEX IF NOT EXISTS idx_reps_identity ON representatives(identity_id)',
      'CREATE INDEX IF NOT EXISTS idx_suppliers_identity ON suppliers(identity_id)',
      'CREATE INDEX IF NOT EXISTS idx_suppliers_norm_phone ON suppliers(normalized_phone)',
    ];
    for (const stmt of v11Statements) {
      try {
        await currentPool.query(stmt);
      } catch (err) {
        if (!isIdempotentDdlError(err, stmt)) {
          console.error('[postgres] v11 DDL statement failed:', stmt, err);
          throw err;
        }
      }
    }

    for (const tbl of ['employees', 'suppliers']) {
      const pending = await currentPool.query(
        `SELECT id, phone FROM ${tbl} WHERE (normalized_phone IS NULL OR normalized_phone = '') AND phone IS NOT NULL AND phone <> ''`
      );
      for (const row of pending.rows || []) {
        const norm = normalizePhoneDigits(row.phone);
        if (norm) {
          await currentPool.query(`UPDATE ${tbl} SET normalized_phone = $1 WHERE id = $2`, [norm, row.id]);
        }
      }
    }

    return { success: true, message: 'تم تطبيق هيكل الجداول والفهارس والتسلسلات في PostgreSQL بنجاح.' };
  } catch (err) {
    console.error('[postgres] initializeSchema error:', err);
    return { success: false, error: err?.message || String(err) };
  }
}

export async function closePostgresPool() {
  if (pool) {
    try {
      await pool.end();
    } catch {
      // ignore pool close errors during shutdown
    } finally {
      pool = null;
    }
  }
}

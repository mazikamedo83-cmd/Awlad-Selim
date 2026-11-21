import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(64)",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ",
      "ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancel_reason TEXT DEFAULT ''",
      "ALTER TABLE rep_item_transfers ADD COLUMN IF NOT EXISTS transfer_mode VARCHAR(32) NOT NULL DEFAULT 'transfer'",
      "ALTER TABLE rep_item_transfers ADD COLUMN IF NOT EXISTS dispatched_by TEXT",
      "ALTER TABLE rep_item_transfers ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ",
      "ALTER TABLE customer_item_orders DROP CONSTRAINT IF EXISTS customer_item_orders_status_check",
      "ALTER TABLE customer_item_orders ADD CONSTRAINT customer_item_orders_status_check CHECK (status IN ('pending', 'under_review', 'approved', 'rejected', 'preparing', 'rep_assigned', 'out_for_delivery', 'delivered', 'needs_review', 'invoiced', 'collected', 'closed', 'cancelled'))",
    ];
    for (const stmt of alterStatements) {
      try {
        await currentPool.query(stmt);
      } catch {
        // Ignore on engines where column already exists or constraint differs
      }
    }

    // Ensure v4 tables exist even when upgrading an existing v3 PG DB
    let hasV4Tables = false;
    try {
      const v4Check = await currentPool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'owner_accounts'"
      );
      hasV4Tables = Boolean(v4Check.rows && v4Check.rows.length > 0);
    } catch {
      hasV4Tables = false;
    }
    if (!hasV4Tables) {
      const v4Marker = '-- 34. الحسابات الشخصية';
      const idx = sql.indexOf(v4Marker);
      if (idx !== -1) {
        await currentPool.query(sql.slice(idx));
      }
    }

    // Ensure v5 pairing/device tables exist on pre-existing v4 PG DBs
    let hasV5PairingTables = false;
    try {
      const v5Check = await currentPool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pairing_tokens'"
      );
      hasV5PairingTables = Boolean(v5Check.rows && v5Check.rows.length > 0);
    } catch {
      hasV5PairingTables = false;
    }
    if (!hasV5PairingTables) {
      const v5Marker = '-- 40. روابط الربط الذكي';
      const idx5 = sql.indexOf(v5Marker);
      if (idx5 !== -1) {
        await currentPool.query(sql.slice(idx5));
      }
    }

    // Ensure v6 order advance & sync conflict tables exist on pre-existing v5 PG DBs
    let hasV6SyncTables = false;
    try {
      const v6Check = await currentPool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_advance_payments'"
      );
      hasV6SyncTables = Boolean(v6Check.rows && v6Check.rows.length > 0);
    } catch {
      hasV6SyncTables = false;
    }
    if (!hasV6SyncTables) {
      const v6Marker = '-- 41. الدفعات المقدمة لطلبات العملاء';
      const idx6 = sql.indexOf(v6Marker);
      if (idx6 !== -1) {
        await currentPool.query(sql.slice(idx6));
      }
    }

    // Ensure v7 rep_custody_operations table exists on pre-existing PG DBs
    let hasV7CustodyTable = false;
    try {
      const v7Check = await currentPool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rep_custody_operations'"
      );
      hasV7CustodyTable = Boolean(v7Check.rows && v7Check.rows.length > 0);
    } catch {
      hasV7CustodyTable = false;
    }
    if (!hasV7CustodyTable) {
      const v7Marker = '-- 44. سجل عمليات عهدة المندوب';
      const idx7 = sql.indexOf(v7Marker);
      if (idx7 !== -1) {
        await currentPool.query(sql.slice(idx7));
      }
    }

    return { success: true, message: 'تم تطبيق هيكل الجداول والفهارس والتسلسلات في PostgreSQL بنجاح.' };
  } catch (err) {
    return { success: false, error: err.message };
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

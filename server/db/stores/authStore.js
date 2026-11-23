import crypto from 'node:crypto';
import { getPool, withTransaction, isPgConnectionError, sanitizePgErrorMessage, isUsingInjectedPool } from '../postgres.js';
import {
  withJsonTransaction,
  readJsonDatabase,
  readJsonSessions,
  writeJsonSessions,
  readJsonAuditLogs,
  appendJsonAuditLog,
  withJsonMutex,
} from '../jsonLedger.js';
import {
  hashPasswordBcrypt,
  verifyPasswordAndCheckUpgrade,
  signJwt,
  generateRefreshToken,
  sha256Hex,
  generateServerId,
} from '../../utils/crypto.js';
import {
  AppError,
  nowIso,
  sanitizeUser,
  normalizePhoneDigits,
  buildPhoneLookupVariants,
} from '../../utils/errors.js';
import {
  isPgMode,
  isStrictPostgresMode,
  markPgUnavailable,
  createDatabaseUnavailableError,
  FULL_ADMIN_PERMISSIONS,
  CUSTOMER_DEFAULT_PERMISSIONS,
  REP_DEFAULT_PERMISSIONS,
  resolveDefaultPermissionsForRole,
  sanitizeEffectivePermissionsForRole,
  normalizeCustomerPhonesList,
  mapPgUserRow,
  mapPgCustomerRow,
  isoTimestamp,
} from './mode.js';

function sanitizeUserForRole(user) {
  const safe = sanitizeUser(user);
  if (!safe) return null;
  return {
    ...safe,
    permissions: sanitizeEffectivePermissionsForRole(safe.role, safe.permissions || {}),
  };
}
import {
  buildScopedIdemKey,
  findPgIdempotency,
  savePgIdempotency,
  findJsonIdempotency,
  saveJsonIdempotency,
} from '../../utils/idempotency.js';
import {
  attachRecordToIdentityPgTx,
  attachRecordToIdentityJsonTx,
  resolveIdentityContextForUserPg,
  resolveIdentityContextForUserJson,
} from '../identityManager.js';

const CUSTOMER_PHONE_CONFLICT_MARKER = '[LINK_CONFLICT:CUSTOMER_PHONE]';
const CUSTOMER_PHONE_CONFLICT_WARNING =
  'يوجد تعارض على رقم الهاتف في دليل العملاء (الرقم مسجل مسبقًا لحساب آخر أو متكرر). تم إيقاف التسجيل الذاتي لحين مراجعة الإدارة أو تسجيل الدخول بالحساب القائم.';
const REP_PHONE_CONFLICT_MARKER = '[LINK_CONFLICT:REP_PHONE]';
const REP_PHONE_CONFLICT_WARNING =
  'يوجد تعارض على رقم الهاتف في سجل المناديب (الرقم مسجل مسبقًا لحساب آخر أو متكرر). تم إيقاف التسجيل الذاتي لحين مراجعة الإدارة أو تسجيل الدخول بالحساب القائم.';

const ACCESS_TOKEN_TTL_SEC = 900; // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 30;

export async function recordAuditLog({
  userId = null,
  userName = 'النظام',
  actorIdentityId = null,
  actorEmployeeId = null,
  actingRole = null,
  action,
  module,
  recordId = null,
  oldValues = null,
  newValues = null,
  ipAddress = '',
  deviceInfo = '',
  notes = '',
  client = null,
}) {
  const id = generateServerId('AUD');
  const timestamp = nowIso();
  const detailsText =
    notes ||
    (newValues && typeof newValues === 'object' ? JSON.stringify(newValues) : String(action || ''));

  if (client || (await isPgMode())) {
    const executor = client || getPool();
    if (executor) {
      try {
        await executor.query(
          `INSERT INTO audit_logs (id, timestamp, user_id, user_name, actor_identity_id, actor_employee_id, acting_role, action, module, record_id, old_values, new_values, ip_address, device_info, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            id,
            timestamp,
            userId,
            userName,
            actorIdentityId || null,
            actorEmployeeId || null,
            actingRole || null,
            action,
            module,
            recordId,
            oldValues ? JSON.stringify(oldValues) : null,
            newValues ? JSON.stringify(newValues) : null,
            ipAddress || '',
            deviceInfo || '',
            detailsText,
          ]
        );
      } catch (err) {
        if (client) throw err;
        if (isStrictPostgresMode() && isPgConnectionError(err)) {
          markPgUnavailable('audit_log_connection_error');
          throw createDatabaseUnavailableError('audit_log_connection_error');
        }
        console.error('[AuditLog PG Error]:', sanitizePgErrorMessage(err?.message));
      }
    }
  } else {
    await appendJsonAuditLog({
      id,
      timestamp,
      userId: userId || 'system',
      userName,
      actorIdentityId: actorIdentityId || undefined,
      actorEmployeeId: actorEmployeeId || undefined,
      actingRole: actingRole || undefined,
      action,
      module,
      recordId: recordId || undefined,
      oldValues: oldValues ?? undefined,
      newValues: newValues ?? undefined,
      details: detailsText,
      ipAddress: ipAddress || '',
      deviceInfo: deviceInfo || '',
    });
  }

  return {
    id,
    timestamp,
    userId: userId || 'system',
    userName,
    actorIdentityId: actorIdentityId || undefined,
    actorEmployeeId: actorEmployeeId || undefined,
    actingRole: actingRole || undefined,
    action,
    module,
    recordId: recordId || undefined,
    oldValues: oldValues ?? undefined,
    newValues: newValues ?? undefined,
    details: detailsText,
  };
}

export async function listAuditLogs(limit = 300) {
  const safeLimit = Math.min(2000, Math.max(1, Number(limit) || 300));
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, timestamp, user_id, user_name, action, module, record_id, old_values, new_values, notes
       FROM audit_logs ORDER BY timestamp DESC LIMIT $1`,
      [safeLimit]
    );
    return res.rows.map((r) => ({
      id: r.id,
      timestamp: isoTimestamp(r.timestamp),
      userId: r.user_id || 'system',
      userName: r.user_name || 'النظام',
      action: r.action,
      module: r.module,
      recordId: r.record_id || undefined,
      oldValues: r.old_values ?? undefined,
      newValues: r.new_values ?? undefined,
      details: r.notes || (r.new_values ? JSON.stringify(r.new_values) : r.action),
    }));
  }
  return readJsonAuditLogs().slice(0, safeLimit);
}

export async function ensureInstallationId() {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT id, extra_settings FROM system_settings LIMIT 1');
    const row = res.rows[0];
    const existingId = String(row?.extra_settings?.installationId || '').trim();
    if (existingId) return existingId;

    const instId = generateServerId('INST');
    if (row) {
      const nextExtra = { ...(row.extra_settings || {}), installationId: instId };
      await pool.query('UPDATE system_settings SET extra_settings = $1 WHERE id = $2', [
        JSON.stringify(nextExtra),
        row.id,
      ]);
    } else {
      await pool.query(
        `INSERT INTO system_settings (id, company_name, company_subtitle, currency, default_print_mode, invoice_notes, allow_negative_stock, extra_settings)
         VALUES ('default', 'مؤسسة أولاد سليم للتجارة والتوزيع', 'نظام المحاسبة وإدارة الأعمال المتكامل', 'ج.م', 'a4', 'شكرًا لتعاملكم معنا', FALSE, $1)`,
        [JSON.stringify({ installationId: instId })]
      );
    }
    return instId;
  }

  const db = readJsonDatabase();
  if (db.installationId && String(db.installationId).trim()) {
    return String(db.installationId).trim();
  }
  return withJsonTransaction((working) => {
    if (!working.installationId || !String(working.installationId).trim()) {
      working.installationId = generateServerId('INST');
    }
    return working.installationId;
  });
}

export async function getAuthStatus() {
  const installationId = await ensureInstallationId();
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(
      `SELECT COUNT(*)::int AS cnt, COUNT(*) FILTER (WHERE role = 'admin')::int AS admin_cnt FROM users`
    );
    const count = Number(res.rows[0]?.cnt || 0);
    const adminsCount = Number(res.rows[0]?.admin_cnt || 0);
    return {
      needsAdminSetup: count === 0 && adminsCount === 0,
      usersCount: count,
      adminsCount,
      installationId,
      mode: 'postgresql-enterprise',
    };
  }
  const db = readJsonDatabase();
  const count = Array.isArray(db.users) ? db.users.length : 0;
  const adminsCount = Array.isArray(db.users)
    ? db.users.filter((u) => u?.role === 'admin').length
    : 0;
  return {
    needsAdminSetup: count === 0 && adminsCount === 0,
    usersCount: count,
    adminsCount,
    installationId,
    mode: 'local-json-ledger',
  };
}

function constantTimeEqualSecret(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(sha256Hex(provided), 'utf8');
  const b = Buffer.from(sha256Hex(expected), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function toAdvisoryLockInt32(key) {
  const hex = sha256Hex(String(key || '')).slice(0, 8);
  return (Number.parseInt(hex, 16) | 0) || 1;
}

export async function acquirePgTxAdvisoryLock(client, namespaceInt, keyInt) {
  let savepointCreated = false;
  try {
    await client.query('SAVEPOINT sp_adv_lock');
    savepointCreated = true;
    await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [namespaceInt, keyInt]);
    await client.query('RELEASE SAVEPOINT sp_adv_lock');
  } catch (err) {
    if (savepointCreated) {
      await client.query('ROLLBACK TO SAVEPOINT sp_adv_lock').catch(() => {});
      await client.query('RELEASE SAVEPOINT sp_adv_lock').catch(() => {});
    }
    const msg = String(err?.message || '').toLowerCase();
    const hasPgSqlState = /^[0-9A-Z]{5}$/i.test(String(err?.code || ''));
    // Strictly tolerate ONLY pg-mem test-harness lack of savepoints / advisory lock; NEVER ignore real PG or SQLSTATE errors!
    const isPgMemMissingFeature =
      isUsingInjectedPool() &&
      !isPgConnectionError(err) &&
      !hasPgSqlState &&
      !err?.severity &&
      (msg.includes('pg-mem') || msg.includes('https://github.com/oguimbal/pg-mem'));
    if (isPgMemMissingFeature) {
      return;
    }
    throw err;
  }
}

export async function bootstrapAdmin(
  { fullName, username, password, phone = '', companyName = '', bootstrapSecret = '' },
  meta = {}
) {
  const cleanUser = String(username || '').trim();
  const cleanName = String(fullName || '').trim();
  const cleanPass = String(password || '');
  const cleanCompany = String(companyName || '').trim();
  const isProd = process.env.NODE_ENV === 'production';
  const expectedSecret = String(process.env.BOOTSTRAP_ADMIN_SECRET || '').trim();
  const rawIp = String(meta.ipAddress || '').trim();
  const isLoopbackCaller =
    !rawIp ||
    rawIp === '127.0.0.1' ||
    rawIp === '::1' ||
    rawIp === '::ffff:127.0.0.1';
  const isElectronLocalLoopback =
    process.env.AWLAD_ELECTRON === 'true' && !isStrictPostgresMode() && isLoopbackCaller;
  if ((isProd && !isElectronLocalLoopback) || expectedSecret) {
    const providedSecret = String(meta.bootstrapSecret || bootstrapSecret || '').trim();
    if (!expectedSecret || !constantTimeEqualSecret(providedSecret, expectedSecret)) {
      throw new AppError(403, 'تعذر إتمام عملية التهيئة الأولية للنظام.', 'BOOTSTRAP_FORBIDDEN');
    }
  }
  if (!cleanUser || cleanUser.length < 3) {
    throw new AppError(400, 'اسم المستخدم يجب أن لا يقل عن 3 أحرف', 'INVALID_USERNAME');
  }
  if (!cleanName || cleanName.length < 2) {
    throw new AppError(400, 'يرجى إدخال الاسم الكامل للمسؤول', 'INVALID_NAME');
  }
  if (!cleanPass || cleanPass.length < 6) {
    throw new AppError(400, 'كلمة المرور يجب أن لا تقل عن 6 أحرف', 'WEAK_PASSWORD');
  }

  return withRegistrationLocks(['__bootstrap_admin__'], async () => {
    const passwordHash = await hashPasswordBcrypt(cleanPass);
    const adminId = generateServerId('USR');
    const now = nowIso();
    const ensuredInstallationId = await ensureInstallationId();

    if (await isPgMode()) {
      let created;
      try {
        created = await withTransaction(async (client) => {
          await acquirePgTxAdvisoryLock(client, 849201, 1);

          const existingUsers = await client.query(`SELECT id, role FROM users`);
          const totalUsers = existingUsers.rows.length;
          const adminCount = existingUsers.rows.filter((r) => r.role === 'admin').length;
          if (totalUsers > 0 || adminCount > 0) {
            throw new AppError(403, 'تم تهيئة حساب المدير مسبقًا. استخدم تسجيل الدخول.', 'ALREADY_BOOTSTRAPPED');
          }

          // Atomic singleton guard across all PG processes and connections
          await client.query(
            `INSERT INTO system_bootstrap_lock (id, admin_user_id, created_at) VALUES ('singleton', $1, $2)`,
            [adminId, now]
          );

        await client.query(
          `INSERT INTO users (id, full_name, username, password_hash, password_algo, phone, normalized_phone, role, job_title, department, is_active, must_change_password, permissions, created_at)
           VALUES ($1, $2, $3, $4, 'bcrypt', $5, $6, 'admin', 'المدير العام', 'الإدارة', TRUE, FALSE, $7, $8)`,
          [adminId, cleanName, cleanUser, passwordHash, phone || '', normalizePhoneDigits(phone || ''), JSON.stringify(FULL_ADMIN_PERMISSIONS), now]
        );

        const whCheck = await client.query('SELECT COUNT(*)::int AS cnt FROM warehouses');
        if (Number(whCheck.rows[0]?.cnt || 0) === 0) {
          await client.query(
            `INSERT INTO warehouses (id, name, code, location, is_default, status) VALUES ('wh-main', 'المستودع الرئيسي', 'WH-01', 'المقر الرئيسي', TRUE, 'active')`
          );
        }

        const cbCheck = await client.query('SELECT COUNT(*)::int AS cnt FROM cashboxes');
        if (Number(cbCheck.rows[0]?.cnt || 0) === 0) {
          await client.query(
            `INSERT INTO cashboxes (id, name, type, opening_balance, current_balance, is_default) VALUES ('cb-main', 'الخزينة الرئيسية', 'cashbox', 0, 0, TRUE)`
          );
        }

        const stRes = await client.query('SELECT id, extra_settings FROM system_settings LIMIT 1');
        if (!stRes.rows[0]) {
          await client.query(
            `INSERT INTO system_settings (id, company_name, company_subtitle, currency, default_print_mode, invoice_notes, allow_negative_stock, extra_settings)
             VALUES ('default', $1, 'نظام المحاسبة وإدارة الأعمال المتكامل', 'ج.م', 'a4', 'شكرًا لتعاملكم معنا', FALSE, $2)`,
            [cleanCompany || 'مؤسسة أولاد سليم للتجارة والتوزيع', JSON.stringify({ installationId: ensuredInstallationId })]
          );
        } else {
          const curRow = stRes.rows[0];
          const nextExtra = {
            ...(curRow.extra_settings || {}),
            installationId: curRow.extra_settings?.installationId || ensuredInstallationId,
          };
          if (cleanCompany) {
            await client.query(
              `UPDATE system_settings SET company_name = $1, extra_settings = $2 WHERE id = $3`,
              [cleanCompany, JSON.stringify(nextExtra), curRow.id]
            );
          } else if (!curRow.extra_settings?.installationId) {
            await client.query(`UPDATE system_settings SET extra_settings = $1 WHERE id = $2`, [
              JSON.stringify(nextExtra),
              curRow.id,
            ]);
          }
        }

          await attachRecordToIdentityPgTx(client, {
            entityType: 'user',
            entityId: adminId,
            roleKey: 'user',
            fullName: cleanName,
            phone: phone || '',
            isPrimary: true,
            now,
          });

          const uRes = await client.query('SELECT * FROM users WHERE id = $1', [adminId]);
          return mapPgUserRow(uRes.rows[0]);
        });
      } catch (err) {
        if (err?.code === '23505') {
          throw new AppError(403, 'تم تهيئة حساب المدير مسبقًا. استخدم تسجيل الدخول.', 'ALREADY_BOOTSTRAPPED');
        }
        throw err;
      }

      await recordAuditLog({
        userId: created.id,
        userName: created.fullName,
        action: 'تهيئة حساب المدير العام لأول مرة',
        module: 'المصادقة',
        recordId: created.id,
        ipAddress: meta.ipAddress,
        deviceInfo: meta.deviceInfo,
      });

      return sanitizeUserForRole(created);
    }

    const created = await withJsonTransaction(async (db) => {
      const hasAdmin = (db.users || []).some((u) => u?.role === 'admin');
      if (db.users.length > 0 || hasAdmin) {
        throw new AppError(403, 'تم تهيئة حساب المدير مسبقًا. استخدم تسجيل الدخول.', 'ALREADY_BOOTSTRAPPED');
      }
      if (!db.installationId) {
        db.installationId = ensuredInstallationId;
      }
      const adminUser = {
        id: adminId,
        fullName: cleanName,
        username: cleanUser,
        passwordHash,
        passwordAlgo: 'bcrypt',
        phone: phone || '',
        role: 'admin',
        jobTitle: 'المدير العام',
        department: 'الإدارة',
        isActive: true,
        mustChangePassword: false,
        permissions: FULL_ADMIN_PERMISSIONS,
        createdAt: now,
      };
      db.users.push(adminUser);
      attachRecordToIdentityJsonTx(db, {
        entityType: 'user',
        entityId: adminId,
        roleKey: 'user',
        fullName: cleanName,
        phone: phone || '',
        isPrimary: true,
        now,
      });
      if (cleanCompany) db.settings.companyName = cleanCompany;
      return adminUser;
    });

    await recordAuditLog({
      userId: created.id,
      userName: created.fullName,
      action: 'تهيئة حساب المدير العام لأول مرة',
      module: 'المصادقة',
      recordId: created.id,
      ipAddress: meta.ipAddress,
      deviceInfo: meta.deviceInfo,
    });

    return sanitizeUserForRole(created);
  });
}

async function resolveLinkedProfilesPg(clientOrPool, user) {
  let customerProfile = null;
  let representativeProfile = null;
  let linkWarning = null;

  if (user.role === 'customer') {
    const custRes = await clientOrPool.query('SELECT * FROM customers WHERE user_id = $1 LIMIT 1', [user.id]);
    if (custRes.rows[0]) {
      customerProfile = mapPgCustomerRow(custRes.rows[0]);
      if (customerProfile?.assignedRepId) {
        const repRes = await clientOrPool.query(
          'SELECT id, name, phone FROM representatives WHERE id = $1 LIMIT 1',
          [customerProfile.assignedRepId]
        );
        if (repRes.rows[0]) {
          customerProfile.assignedRep = {
            id: repRes.rows[0].id,
            name: repRes.rows[0].name,
            phone: repRes.rows[0].phone || '',
          };
        }
      }
    } else if (String(user.notes || '').includes(CUSTOMER_PHONE_CONFLICT_MARKER)) {
      linkWarning = CUSTOMER_PHONE_CONFLICT_WARNING;
    } else {
      linkWarning = 'حساب العميل غير مربوط بملف عميل في الدليل. يرجى التواصل مع الإدارة لإتمام الربط.';
    }
  } else if (user.role === 'representative') {
    const repRes = await clientOrPool.query('SELECT * FROM representatives WHERE user_id = $1 LIMIT 1', [user.id]);
    if (repRes.rows[0]) {
      const r = repRes.rows[0];
      representativeProfile = {
        id: r.id,
        name: r.name,
        phone: r.phone || '',
        vehicleNumber: r.vehicle_number || '',
        warehouseId: r.warehouse_id || undefined,
        currentBalance: Number(r.current_balance || 0),
        status: r.status || 'active',
      };
    } else if (String(user.notes || '').includes(REP_PHONE_CONFLICT_MARKER)) {
      linkWarning = REP_PHONE_CONFLICT_WARNING;
    } else {
      linkWarning = 'حساب المندوب غير مربوط بملف مندوب مسجل. يرجى التواصل مع الإدارة لإتمام الربط.';
    }
  }

  const identityCtx = await resolveIdentityContextForUserPg(clientOrPool, user);
  return {
    customerProfile,
    representativeProfile,
    linkWarning,
    identityId: identityCtx.identityId,
    employeeId: identityCtx.employeeId,
    linkedRoles: identityCtx.linkedRoles,
  };
}

function resolveLinkedProfilesJson(db, user) {
  let customerProfile = null;
  let representativeProfile = null;
  let linkWarning = null;

  if (user.role === 'customer') {
    const cust = db.customers.find((c) => c.userId === user.id);
    if (cust) {
      const cloned = structuredClone(cust);
      if (cloned.assignedRepId) {
        const rep = (db.representatives || []).find((r) => r.id === cloned.assignedRepId);
        if (rep) {
          cloned.assignedRep = {
            id: rep.id,
            name: rep.name,
            phone: rep.phone || '',
          };
        }
      }
      customerProfile = cloned;
    } else if (String(user.notes || '').includes(CUSTOMER_PHONE_CONFLICT_MARKER)) {
      linkWarning = CUSTOMER_PHONE_CONFLICT_WARNING;
    } else {
      linkWarning = 'حساب العميل غير مربوط بملف عميل في الدليل. يرجى التواصل مع الإدارة لإتمام الربط.';
    }
  } else if (user.role === 'representative') {
    const rep = db.representatives.find((r) => r.userId === user.id);
    if (rep) {
      representativeProfile = {
        id: rep.id,
        name: rep.name,
        phone: rep.phone || '',
        vehicleNumber: rep.vehicleNumber || '',
        warehouseId: rep.warehouseId || undefined,
        currentBalance: Number(rep.currentBalance || 0),
        status: rep.status || 'active',
        identityId: rep.identityId || undefined,
      };
    } else if (String(user.notes || '').includes(REP_PHONE_CONFLICT_MARKER)) {
      linkWarning = REP_PHONE_CONFLICT_WARNING;
    } else {
      linkWarning = 'حساب المندوب غير مربوط بملف مندوب مسجل. يرجى التواصل مع الإدارة لإتمام الربط.';
    }
  }

  const identityCtx = resolveIdentityContextForUserJson(db, user);
  return {
    customerProfile,
    representativeProfile,
    linkWarning,
    identityId: identityCtx.identityId,
    employeeId: identityCtx.employeeId,
    linkedRoles: identityCtx.linkedRoles,
  };
}

async function checkDeviceAuthGuardInternal(deviceId, clientOrPool = null) {
  const cleanId = String(deviceId || '').trim();
  if (!cleanId) return;
  let device = null;
  if (await isPgMode()) {
    const q = clientOrPool || getPool();
    const res = await q.query('SELECT status FROM paired_devices WHERE device_id = $1 LIMIT 1', [cleanId]);
    device = res.rows[0] || null;
  } else {
    const db = readJsonDatabase();
    device = (db.pairedDevices || []).find((d) => d.deviceId === cleanId) || null;
  }
  if (!device) return;
  if (device.status === 'revoked') {
    throw new AppError(
      403,
      'تم فصل أو إلغاء ربط هذا الجهاز من قِبل الإدارة. يرجى إعادة الربط عبر رابط جديد.',
      'DEVICE_REVOKED'
    );
  }
  if (device.status === 'pending_approval') {
    throw new AppError(
      403,
      'هذا الجهاز بانتظار موافقة مدير النظام في لوحة إدارة الأجهزة.',
      'DEVICE_PENDING_APPROVAL'
    );
  }
}

export async function checkDeviceAuthGuard(deviceId) {
  return checkDeviceAuthGuardInternal(deviceId, null);
}

export async function loginUser({
  username,
  password,
  deviceId = '',
  deviceName = '',
  deviceType = '',
  osVersion = '',
  appVersion = '',
  connectionMode = '',
  serverUrlUsed = '',
  deviceInfo = '',
  ipAddress = '',
}) {
  const cleanUsername = String(username || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  const cleanDeviceId = String(deviceId || '').trim().slice(0, 64);
  if (!cleanUsername || !cleanPassword) {
    throw new AppError(400, 'يرجى إدخال اسم المستخدم وكلمة المرور', 'MISSING_CREDENTIALS');
  }

  if (cleanDeviceId) {
    await checkDeviceAuthGuardInternal(cleanDeviceId);
  }

  const expiresDate = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400 * 1000).toISOString();
  const refreshToken = generateRefreshToken();
  const refreshHash = sha256Hex(refreshToken);
  const sessionId = generateServerId('SES');
  const now = nowIso();

  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      const res = await client.query(
        `SELECT * FROM users WHERE LOWER(username) = $1 OR phone = $2 LIMIT 1`,
        [cleanUsername, String(username || '').trim()]
      );
      const row = res.rows[0];
      if (!row) {
        throw new AppError(401, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS');
      }
      if (!row.is_active) {
        throw new AppError(403, 'تم إيقاف هذا الحساب من قِبل الإدارة', 'ACCOUNT_SUSPENDED');
      }

      const { valid, needsUpgrade } = await verifyPasswordAndCheckUpgrade(cleanPassword, row.password_hash);
      if (!valid) {
        throw new AppError(401, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS');
      }

      if (needsUpgrade) {
        const newHash = await hashPasswordBcrypt(cleanPassword);
        await client.query(
          `UPDATE users SET password_hash = $1, password_algo = 'bcrypt', last_login = $2, updated_at = $2 WHERE id = $3`,
          [newHash, now, row.id]
        );
      } else {
        await client.query(`UPDATE users SET last_login = $1 WHERE id = $2`, [now, row.id]);
      }

      await client.query(
        `INSERT INTO user_sessions (id, user_id, refresh_token_hash, device_info, device_id, ip_address, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [sessionId, row.id, refreshHash, deviceInfo || '', cleanDeviceId || null, ipAddress || '', expiresDate, now]
      );

      const userObj = mapPgUserRow(row);
      userObj.lastLogin = now;

      if (cleanDeviceId) {
        const devRes = await client.query('SELECT device_id, status FROM paired_devices WHERE device_id = $1 LIMIT 1', [
          cleanDeviceId,
        ]);
        if (devRes.rows[0]) {
          await client.query(
            `UPDATE paired_devices SET linked_user_id = $1, linked_user_name = $2, last_seen_at = $3, ip_address = COALESCE(NULLIF($4, ''), ip_address)
             WHERE device_id = $5`,
            [userObj.id, userObj.fullName, now, ipAddress || '', cleanDeviceId]
          );
        } else {
          const inferredType =
            deviceType || (/iphone|ipad/i.test(deviceInfo) ? 'ios' : /android/i.test(deviceInfo) ? 'android' : /electron|windows/i.test(deviceInfo) ? 'windows' : 'web');
          await client.query(
            `INSERT INTO paired_devices (device_id, device_name, device_type, os_version, app_version, linked_user_id, linked_user_name, connection_mode, server_url_used, ip_address, status, paired_at, last_seen_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$11)`,
            [
              cleanDeviceId,
              String(deviceName || `${userObj.fullName} (${inferredType})`).slice(0, 120),
              inferredType,
              String(osVersion || '').slice(0, 80),
              String(appVersion || '3.0.0').slice(0, 40),
              userObj.id,
              userObj.fullName,
              String(connectionMode || 'local_network').slice(0, 32),
              String(serverUrlUsed || '').slice(0, 300),
              String(ipAddress || '').slice(0, 64),
              now,
            ]
          );
        }
      }

      const profiles = await resolveLinkedProfilesPg(client, userObj);
      return { user: userObj, ...profiles };
    });

    const installationId = await ensureInstallationId();
    const accessToken = signJwt(
      {
        sub: result.user.id,
        role: result.user.role,
        sid: sessionId,
        did: cleanDeviceId || null,
        iid: installationId,
        cid: result.customerProfile?.id || null,
        rid: result.representativeProfile?.id || null,
      },
      ACCESS_TOKEN_TTL_SEC
    );

    await recordAuditLog({
      userId: result.user.id,
      userName: result.user.fullName,
      action: 'تسجيل دخول ناجح',
      module: 'المصادقة',
      recordId: sessionId,
      ipAddress,
      deviceInfo,
    });

    const enrichedUser = {
      ...result.user,
      identityId: result.user.identityId || result.identityId,
      employeeId: result.user.employeeId || result.employeeId,
    };

    return {
      installationId,
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SEC,
      user: sanitizeUserForRole(enrichedUser),
      identityId: enrichedUser.identityId,
      employeeId: enrichedUser.employeeId,
      linkedRoles: result.linkedRoles || [],
      customerProfile: result.customerProfile,
      representativeProfile: result.representativeProfile,
      linkWarning: result.linkWarning,
    };
  }

  // JSON Ledger fallback
  const found = await withJsonTransaction(async (db) => {
    const rawTrim = String(username || '').trim();
    const user = db.users.find(
      (u) => String(u.username || '').toLowerCase() === cleanUsername || (u.phone && String(u.phone).trim() === rawTrim)
    );
    if (!user) {
      throw new AppError(401, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS');
    }
    if (!user.isActive) {
      throw new AppError(403, 'تم إيقاف هذا الحساب من قِبل الإدارة', 'ACCOUNT_SUSPENDED');
    }
    const { valid, needsUpgrade } = await verifyPasswordAndCheckUpgrade(cleanPassword, user.passwordHash);
    if (!valid) {
      throw new AppError(401, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS');
    }
    if (needsUpgrade) {
      user.passwordHash = await hashPasswordBcrypt(cleanPassword);
      user.passwordAlgo = 'bcrypt';
    }
    user.lastLogin = now;
    if (cleanDeviceId) {
      if (!Array.isArray(db.pairedDevices)) db.pairedDevices = [];
      const existingDev = db.pairedDevices.find((d) => d.deviceId === cleanDeviceId);
      if (existingDev) {
        existingDev.linkedUserId = user.id;
        existingDev.linkedUserName = user.fullName;
        existingDev.lastSeenAt = now;
        if (ipAddress) existingDev.ipAddress = ipAddress;
      } else {
        const inferredType =
          deviceType || (/iphone|ipad/i.test(deviceInfo) ? 'ios' : /android/i.test(deviceInfo) ? 'android' : /electron|windows/i.test(deviceInfo) ? 'windows' : 'web');
        db.pairedDevices.unshift({
          deviceId: cleanDeviceId,
          deviceName: String(deviceName || `${user.fullName} (${inferredType})`).slice(0, 120),
          deviceType: inferredType,
          osVersion: String(osVersion || '').slice(0, 80),
          appVersion: String(appVersion || '3.0.0').slice(0, 40),
          linkedUserId: user.id,
          linkedUserName: user.fullName,
          connectionMode: String(connectionMode || 'local_network').slice(0, 32),
          serverUrlUsed: String(serverUrlUsed || '').slice(0, 300),
          ipAddress: String(ipAddress || '').slice(0, 64),
          status: 'active',
          configVersion: 1,
          pairedAt: now,
          lastSeenAt: now,
        });
      }
    }
    const profiles = resolveLinkedProfilesJson(db, user);
    return { user: structuredClone(user), ...profiles };
  });

  const installationId = await ensureInstallationId();

  await withJsonMutex(async () => {
    const sessions = readJsonSessions().filter((s) => !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now());
    sessions.push({
      id: sessionId,
      userId: found.user.id,
      installationId,
      refreshTokenHash: refreshHash,
      deviceInfo: deviceInfo || '',
      deviceId: cleanDeviceId || '',
      ipAddress: ipAddress || '',
      expiresAt: expiresDate,
      revokedAt: null,
      createdAt: now,
    });
    writeJsonSessions(sessions);
  });

  const accessToken = signJwt(
    {
      sub: found.user.id,
      role: found.user.role,
      sid: sessionId,
      did: cleanDeviceId || null,
      iid: installationId,
      cid: found.customerProfile?.id || null,
      rid: found.representativeProfile?.id || null,
    },
    ACCESS_TOKEN_TTL_SEC
  );

  await recordAuditLog({
    userId: found.user.id,
    userName: found.user.fullName,
    action: 'تسجيل دخول ناجح',
    module: 'المصادقة',
    recordId: sessionId,
    ipAddress,
    deviceInfo,
  });

  const enrichedFoundUser = {
    ...found.user,
    identityId: found.user.identityId || found.identityId,
    employeeId: found.user.employeeId || found.employeeId,
  };

  return {
    installationId,
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    user: sanitizeUserForRole(enrichedFoundUser),
    identityId: enrichedFoundUser.identityId,
    employeeId: enrichedFoundUser.employeeId,
    linkedRoles: found.linkedRoles || [],
    customerProfile: found.customerProfile,
    representativeProfile: found.representativeProfile,
    linkWarning: found.linkWarning,
  };
}

function normalizeRegPhone(raw) {
  return normalizePhoneDigits(raw);
}

function sanitizeRegisterPhoto(raw) {
  if (raw === undefined || raw === null) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;
  if (/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^\/api\/[A-Za-z0-9_./-]+$/.test(trimmed) || /^https:\/\/[^\s"'<>]+$/i.test(trimmed)) {
    return trimmed;
  }
  throw new AppError(
    400,
    'صيغة صورة المحل غير مدعومة أو غير آمنة (يُسمح بصور PNG أو JPG أو WEBP أو رابط HTTPS فقط)',
    'INVALID_CUSTOMER_PHOTO'
  );
}

function customerHasRegPhone(cust, normPhone) {
  if (!normPhone || !cust) return false;
  if (normalizeRegPhone(cust.phone) === normPhone) return true;
  if (normalizeRegPhone(cust.secondary_phone ?? cust.secondaryPhone) === normPhone) return true;
  if (Array.isArray(cust.phones)) {
    return cust.phones.some((p) => normalizeRegPhone(typeof p === 'string' ? p : (p?.number ?? p?.phone)) === normPhone);
  }
  return false;
}

const registrationKeyLocks = new Map();
async function withRegistrationLocks(keys, fn) {
  const uniqueKeys = [...new Set((keys || []).filter(Boolean))].sort();
  if (uniqueKeys.length === 0) return fn();

  const acquireChain = async (idx) => {
    if (idx >= uniqueKeys.length) return fn();
    const key = uniqueKeys[idx];
    const prev = registrationKeyLocks.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const nextChain = prev.then(() => gate, () => gate);
    registrationKeyLocks.set(key, nextChain);
    await prev.catch(() => {});
    try {
      return await acquireChain(idx + 1);
    } finally {
      release();
      if (registrationKeyLocks.get(key) === nextChain) {
        registrationKeyLocks.delete(key);
      }
    }
  };

  return acquireChain(0);
}

export async function registerMobileAccount(payload = {}, meta = {}) {
  const role = String(payload.role || '').trim();
  if (role !== 'customer' && role !== 'representative') {
    throw new AppError(403, 'التسجيل الذاتي متاح لحسابات العملاء والمناديب فقط', 'FORBIDDEN_REGISTER_ROLE');
  }

  const fullName = String(payload.fullName || '').trim();
  const username = String(payload.username || '').trim();
  const cleanUsernameLower = username.toLowerCase();
  const password = String(payload.password || '');
  const phone = String(payload.phone || '').trim();
  const address = String(payload.address || '').trim();
  const shopName = String(payload.shopName || '').trim();
  const governorate = String(payload.governorate || '').trim();
  const area = String(payload.area || '').trim();
  const vehicleNumber = String(payload.vehicleNumber || '').trim();
  const geoCoordinates = String(payload.geoCoordinates || '').trim();
  const safeShopPhoto = role === 'customer' ? sanitizeRegisterPhoto(payload.shopPhoto ?? payload.photo) : undefined;
  const regPhones = role === 'customer'
    ? normalizeCustomerPhonesList(Array.isArray(payload.phones) ? payload.phones : [], phone, '')
    : [];
  const cleanDeviceId = String(payload.deviceId || meta.deviceId || '').trim().slice(0, 64);

  if (fullName.length < 2) {
    throw new AppError(400, 'يرجى إدخال الاسم الكامل (حرفين على الأقل)', 'INVALID_NAME');
  }
  if (username.length < 3) {
    throw new AppError(400, 'اسم المستخدم يجب أن لا يقل عن 3 أحرف', 'INVALID_USERNAME');
  }
  if (password.length < 6) {
    throw new AppError(400, 'كلمة المرور يجب أن لا تقل عن 6 أحرف', 'WEAK_PASSWORD');
  }
  if (!phone) {
    throw new AppError(400, 'يرجى إدخال رقم الهاتف للتسجيل', 'PHONE_REQUIRED');
  }

  if (cleanDeviceId) {
    await checkDeviceAuthGuardInternal(cleanDeviceId);
  }

  const rawIdemKey = String(payload.idempotencyKey || payload.operationId || meta.idempotencyKey || '').trim();
  const scopedIdem = buildScopedIdemKey('POST /api/auth/register', { id: 'anon' }, rawIdemKey);
  const normPhone = normalizeRegPhone(phone);
  const payloadDigest = sha256Hex(`${role}::${cleanUsernameLower}::${normPhone}`);
  const installationId = await ensureInstallationId();

  const passwordHash = await hashPasswordBcrypt(password);
  const userId = generateServerId('USR');
  const sessionId = generateServerId('SES');
  const refreshToken = generateRefreshToken();
  const refreshHash = sha256Hex(refreshToken);
  const expiresDate = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400 * 1000).toISOString();
  const now = nowIso();
  const fallbackPermissions = resolveDefaultPermissionsForRole(role, {});

  const lockKeys = [
    `u:${cleanUsernameLower}`,
    normPhone ? `p:${role}:${normPhone}` : '',
  ];

  return withRegistrationLocks(lockKeys, async () => {
  if (await isPgMode()) {
    const preDup = scopedIdem ? await findPgIdempotency(getPool(), scopedIdem) : null;
    if (preDup?.response && preDup.payloadDigest === payloadDigest) {
      return preDup.response;
    }

    let result;
    try {
      result = await withTransaction(async (client) => {
        // Cross-process PostgreSQL transaction advisory locks on username & phone
        await acquirePgTxAdvisoryLock(client, 849202, toAdvisoryLockInt32(`u:${cleanUsernameLower}`));
        if (normPhone) {
          await acquirePgTxAdvisoryLock(client, 849203, toAdvisoryLockInt32(`p:${role}:${normPhone}`));
        }

        if (scopedIdem) {
          const txDup = await findPgIdempotency(client, scopedIdem);
          if (txDup?.response && txDup.payloadDigest === payloadDigest) {
            return { deduplicated: true, response: txDup.response };
          }
        }

        const dupUser = await client.query(`SELECT id FROM users WHERE LOWER(username) = $1 LIMIT 1`, [cleanUsernameLower]);
        if (dupUser.rows[0]) {
          throw new AppError(409, 'اسم المستخدم مسجل مسبقًا، يرجى اختيار اسم آخر أو تسجيل الدخول', 'DUPLICATE_USERNAME');
        }
        if (normPhone) {
          const dupPhoneUser = await client.query(
            `SELECT id FROM users WHERE role = $1 AND normalized_phone = $2 AND normalized_phone <> '' LIMIT 1`,
            [role, normPhone]
          );
          if (dupPhoneUser.rows[0]) {
            throw new AppError(
              409,
              role === 'representative' ? REP_PHONE_CONFLICT_WARNING : CUSTOMER_PHONE_CONFLICT_WARNING,
              role === 'representative' ? 'REP_PHONE_CONFLICT' : 'CUSTOMER_PHONE_CONFLICT'
            );
          }
        }

        let customerProfile = null;
        let representativeProfile = null;
        const userNotes = 'حساب مسجل ذاتيًا عبر الموبايل';
        let lockedUnlinkedCustomer = null;
        let lockedUnlinkedRep = null;
        const { variants: phoneVariants, suffixPattern } = buildPhoneLookupVariants(phone);

        if (role === 'customer') {
          if (normPhone) {
            const custWhereParts = [`normalized_phone = $1`];
            const custParams = [normPhone];
            if (phoneVariants.length > 0) {
              const placeholders = phoneVariants
                .map((v) => {
                  custParams.push(v);
                  return `$${custParams.length}`;
                })
                .join(', ');
              custWhereParts.push(`phone IN (${placeholders})`);
              custWhereParts.push(`secondary_phone IN (${placeholders})`);
            }
            if (suffixPattern) {
              custParams.push(suffixPattern);
              custWhereParts.push(`CAST(phones AS TEXT) LIKE $${custParams.length}`);
            }
            const custCandRes = await client.query(
              `SELECT id, user_id, phone, secondary_phone, phones FROM customers WHERE ${custWhereParts.join(' OR ')} ORDER BY id ASC`,
              custParams
            );
            const candIds = custCandRes.rows
              .filter((c) => customerHasRegPhone(c, normPhone))
              .map((c) => c.id)
              .sort();
            const lockedCusts = [];
            for (const cid of candIds) {
              const r = await client.query(`SELECT * FROM customers WHERE id = $1 FOR UPDATE`, [cid]);
              if (r.rows[0]) lockedCusts.push(r.rows[0]);
            }
            const allMatches = lockedCusts.filter((c) => customerHasRegPhone(c, normPhone));
            const hasAlreadyLinkedMatch = allMatches.some((c) => Boolean(c.user_id));

            if (allMatches.length > 1 || hasAlreadyLinkedMatch) {
              throw new AppError(409, CUSTOMER_PHONE_CONFLICT_WARNING, 'CUSTOMER_PHONE_CONFLICT');
            }
            const unlinkedMatches = allMatches.filter((c) => !c.user_id);
            if (unlinkedMatches.length === 1) {
              lockedUnlinkedCustomer = unlinkedMatches[0];
            }
          }
        } else {
          if (normPhone) {
            const repWhereParts = [`normalized_phone = $1`];
            const repParams = [normPhone];
            if (phoneVariants.length > 0) {
              const placeholders = phoneVariants
                .map((v) => {
                  repParams.push(v);
                  return `$${repParams.length}`;
                })
                .join(', ');
              repWhereParts.push(`phone IN (${placeholders})`);
            }
            const repCandRes = await client.query(
              `SELECT id, user_id, phone FROM representatives WHERE ${repWhereParts.join(' OR ')} ORDER BY id ASC`,
              repParams
            );
            const candIds = repCandRes.rows
              .filter((r) => normalizeRegPhone(r.phone) === normPhone)
              .map((r) => r.id)
              .sort();
            const lockedReps = [];
            for (const rid of candIds) {
              const r = await client.query(`SELECT * FROM representatives WHERE id = $1 FOR UPDATE`, [rid]);
              if (r.rows[0]) lockedReps.push(r.rows[0]);
            }
            const repMatches = lockedReps.filter((r) => normalizeRegPhone(r.phone) === normPhone);
            const hasAlreadyLinkedRep = repMatches.some((r) => Boolean(r.user_id));

            if (repMatches.length > 1 || hasAlreadyLinkedRep) {
              throw new AppError(409, REP_PHONE_CONFLICT_WARNING, 'REP_PHONE_CONFLICT');
            }
            const unlinkedReps = repMatches.filter((r) => !r.user_id);
            if (unlinkedReps.length === 1) {
              lockedUnlinkedRep = unlinkedReps[0];
            }
          }
        }

        const sysPresetRes = await client.query(`SELECT extra_settings FROM system_settings LIMIT 1`);
        const livePermissions = resolveDefaultPermissionsForRole(role, sysPresetRes.rows[0]?.extra_settings || fallbackPermissions);

        await client.query(
          `INSERT INTO users (id, full_name, username, password_hash, password_algo, phone, normalized_phone, address, notes, role, job_title, department, is_active, must_change_password, permissions, created_at)
           VALUES ($1,$2,$3,$4,'bcrypt',$5,$6,$7,$8,$9,$10,$11,TRUE,FALSE,$12,$13)`,
          [
            userId,
            fullName,
            username,
            passwordHash,
            phone,
            normPhone,
            address,
            userNotes,
            role,
            role === 'representative' ? 'مندوب مبيعات' : 'عميل',
            role === 'representative' ? 'المندوبون' : 'العملاء',
            JSON.stringify(livePermissions),
            now,
          ]
        );

        if (role === 'customer') {
          if (lockedUnlinkedCustomer) {
            const target = lockedUnlinkedCustomer;
            const mergedPhones = normalizeCustomerPhonesList(target.phones, phone || target.phone || '', target.secondary_phone || '');
            const mergedPrimary = mergedPhones.find((p) => p.isPrimary)?.number || target.phone || phone || '';
            await client.query(
              `UPDATE customers SET user_id = $1, normalized_phone = $2, shop_name = $3, shop_photo = $4, photo = $4, address = $5, governorate = $6, area = $7, geo_coordinates = $8, phones = $9, updated_at = $10 WHERE id = $11`,
              [
                userId,
                normalizeRegPhone(mergedPrimary) || normPhone,
                shopName || target.shop_name || null,
                safeShopPhoto || target.shop_photo || target.photo || null,
                address || target.address || '',
                governorate || target.governorate || '',
                area || target.area || null,
                geoCoordinates || target.geo_coordinates || null,
                JSON.stringify(mergedPhones),
                now,
                target.id,
              ]
            );
            const refreshed = await client.query(`SELECT * FROM customers WHERE id = $1 LIMIT 1`, [target.id]);
            customerProfile = mapPgCustomerRow(refreshed.rows[0]);
          } else {
            const custId = generateServerId('CUS');
            const custCode = `CUS-${String(Date.now()).slice(-5)}-${Math.floor(10 + Math.random() * 89)}`;
            const initialPhones = regPhones.length > 0 ? regPhones : normalizeCustomerPhonesList([], phone, '');
            const primaryRegPhone = initialPhones.find((p) => p.isPrimary)?.number || initialPhones[0]?.number || phone;
            const secondaryRegPhone = initialPhones.find((p) => !p.isPrimary && p.number !== primaryRegPhone)?.number || null;
            await client.query(
              `INSERT INTO customers (id, code, user_id, name, phone, normalized_phone, secondary_phone, phones, shop_name, shop_photo, photo, address, shop_address, governorate, area, geo_coordinates, opening_balance, current_balance, notes, status, created_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$11,$12,$13,$14,0,0,'عميل مسجل ذاتيًا عبر التطبيق','active',$15,$15)`,
              [
                custId,
                custCode,
                userId,
                fullName,
                primaryRegPhone,
                normalizeRegPhone(primaryRegPhone) || normPhone,
                secondaryRegPhone,
                JSON.stringify(initialPhones),
                shopName || null,
                safeShopPhoto || null,
                address,
                governorate,
                area || null,
                geoCoordinates || null,
                now,
              ]
            );
            const refreshed = await client.query(`SELECT * FROM customers WHERE id = $1 LIMIT 1`, [custId]);
            customerProfile = mapPgCustomerRow(refreshed.rows[0]);
          }
        } else if (role === 'representative') {
          if (lockedUnlinkedRep) {
            const targetRep = lockedUnlinkedRep;
            let targetWhId = targetRep.warehouse_id || null;
            if (!targetWhId) {
              targetWhId = generateServerId('WH');
              const vanCode = `VAN-${String(Date.now()).slice(-4)}-${Math.floor(10 + Math.random() * 89)}`;
              const vanName = `سيارة المندوب - ${targetRep.name || fullName}`;
              await client.query(
                `INSERT INTO warehouses (id, name, code, location, manager_name, phone, is_default, status, created_at)
                 VALUES ($1,$2,$3,'مخزون سيارة مندوب',$4,$5,FALSE,'active',$6)`,
                [targetWhId, vanName, vanCode, targetRep.name || fullName, phone, now]
              );
            }
            const nextRepPhone = phone || targetRep.phone || '';
            await client.query(
              `UPDATE representatives SET user_id = $1, phone = COALESCE(NULLIF($2, ''), phone), normalized_phone = $3, vehicle_number = COALESCE(NULLIF($4, ''), vehicle_number), warehouse_id = $5 WHERE id = $6`,
              [userId, phone, normalizeRegPhone(nextRepPhone) || normPhone, vehicleNumber, targetWhId, targetRep.id]
            );
            const refreshedRep = await client.query(`SELECT * FROM representatives WHERE id = $1 LIMIT 1`, [targetRep.id]);
            const rr = refreshedRep.rows[0];
            representativeProfile = {
              id: rr.id,
              userId: rr.user_id,
              name: rr.name,
              phone: rr.phone || '',
              vehicleNumber: rr.vehicle_number || '',
              warehouseId: rr.warehouse_id || undefined,
              currentBalance: Number(rr.current_balance || 0),
              status: rr.status || 'active',
            };
          } else {
            const vanId = generateServerId('WH');
            const vanCode = `VAN-${String(Date.now()).slice(-4)}-${Math.floor(10 + Math.random() * 89)}`;
            const vanName = `سيارة المندوب - ${fullName}`;
            await client.query(
              `INSERT INTO warehouses (id, name, code, location, manager_name, phone, is_default, status, created_at)
               VALUES ($1,$2,$3,'مخزون سيارة مندوب',$4,$5,FALSE,'active',$6)`,
              [vanId, vanName, vanCode, fullName, phone, now]
            );
            const repId = generateServerId('REP');
            const repCode = `REP-${String(Date.now()).slice(-5)}`;
            await client.query(
              `INSERT INTO representatives (id, code, user_id, name, phone, normalized_phone, vehicle_number, address, opening_balance, current_balance, commission_rate, warehouse_id, notes, status, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,0,0,$9,'مندوب مسجل ذاتيًا عبر التطبيق','active',$10)`,
              [repId, repCode, userId, fullName, phone, normPhone, vehicleNumber, address, vanId, now]
            );
            representativeProfile = {
              id: repId,
              userId,
              name: fullName,
              phone,
              vehicleNumber,
              warehouseId: vanId,
              currentBalance: 0,
              status: 'active',
            };
          }
        }

        await client.query(
          `INSERT INTO user_sessions (id, user_id, refresh_token_hash, device_info, device_id, ip_address, expires_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [sessionId, userId, refreshHash, meta.deviceInfo || '', cleanDeviceId || null, meta.ipAddress || '', expiresDate, now]
        );

        if (cleanDeviceId) {
          const devRes = await client.query(`SELECT device_id FROM paired_devices WHERE device_id = $1 LIMIT 1`, [cleanDeviceId]);
          if (devRes.rows[0]) {
            await client.query(
              `UPDATE paired_devices SET linked_user_id = $1, linked_user_name = $2, last_seen_at = $3 WHERE device_id = $4`,
              [userId, fullName, now, cleanDeviceId]
            );
          } else {
            const inferredType =
              payload.deviceType || (/iphone|ipad/i.test(meta.deviceInfo || '') ? 'ios' : /android/i.test(meta.deviceInfo || '') ? 'android' : 'web');
            await client.query(
              `INSERT INTO paired_devices (device_id, device_name, device_type, linked_user_id, linked_user_name, connection_mode, server_url_used, ip_address, status, paired_at, last_seen_at)
               VALUES ($1,$2,$3,$4,$5,'local_network',$6,$7,'active',$8,$8)`,
              [cleanDeviceId, payload.deviceName || `${fullName} (${inferredType})`, inferredType, userId, fullName, payload.serverUrlUsed || '', meta.ipAddress || '', now]
            );
          }
        }

        let sharedIdentityId =
          lockedUnlinkedCustomer?.identity_id ||
          lockedUnlinkedRep?.identity_id ||
          null;

        if (!sharedIdentityId && lockedUnlinkedCustomer) {
          sharedIdentityId = await attachRecordToIdentityPgTx(client, {
            entityType: 'customer',
            entityId: lockedUnlinkedCustomer.id,
            fullName: lockedUnlinkedCustomer.name || fullName,
            phone: lockedUnlinkedCustomer.phone || phone,
            address: lockedUnlinkedCustomer.address || address,
            isPrimary: false,
            now,
          });
        } else if (!sharedIdentityId && lockedUnlinkedRep) {
          sharedIdentityId = await attachRecordToIdentityPgTx(client, {
            entityType: 'representative',
            entityId: lockedUnlinkedRep.id,
            fullName: lockedUnlinkedRep.name || fullName,
            phone: lockedUnlinkedRep.phone || phone,
            address: lockedUnlinkedRep.address || address,
            isPrimary: false,
            now,
          });
        }

        sharedIdentityId = await attachRecordToIdentityPgTx(client, {
          entityType: 'user',
          entityId: userId,
          roleKey: 'user',
          fullName,
          phone,
          address,
          explicitIdentityId: sharedIdentityId,
          isPrimary: true,
          now,
        });

        if (customerProfile?.id) {
          await attachRecordToIdentityPgTx(client, {
            entityType: 'customer',
            entityId: customerProfile.id,
            roleKey: 'customer',
            fullName: customerProfile.name || fullName,
            phone: customerProfile.phone || phone,
            address: customerProfile.address || address,
            explicitIdentityId: sharedIdentityId,
            now,
          });
          customerProfile.identityId = sharedIdentityId;
        }
        if (representativeProfile?.id) {
          await attachRecordToIdentityPgTx(client, {
            entityType: 'representative',
            entityId: representativeProfile.id,
            roleKey: 'representative',
            fullName: representativeProfile.name || fullName,
            phone: representativeProfile.phone || phone,
            address: address || '',
            explicitIdentityId: sharedIdentityId,
            now,
          });
          representativeProfile.identityId = sharedIdentityId;
        }

        const uRes = await client.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);
        const mappedUser = mapPgUserRow(uRes.rows[0]);
        mappedUser.identityId = mappedUser.identityId || sharedIdentityId;
        const idCtx = await resolveIdentityContextForUserPg(client, mappedUser);
        const accessToken = signJwt(
          {
            sub: mappedUser.id,
            role: mappedUser.role,
            sid: sessionId,
            did: cleanDeviceId || null,
            iid: installationId,
            cid: customerProfile?.id || null,
            rid: representativeProfile?.id || null,
          },
          ACCESS_TOKEN_TTL_SEC
        );
        const response = {
          installationId,
          accessToken,
          refreshToken,
          expiresIn: ACCESS_TOKEN_TTL_SEC,
          user: sanitizeUserForRole(mappedUser),
          identityId: idCtx.identityId,
          employeeId: idCtx.employeeId,
          linkedRoles: idCtx.linkedRoles,
          customerProfile,
          representativeProfile,
          linkWarning: null,
        };
        if (scopedIdem) {
          await savePgIdempotency(client, scopedIdem, { id: mappedUser.id }, 'POST /api/auth/register', {
            payloadDigest,
            response,
          });
        }
        return { deduplicated: false, user: mappedUser, response };
      });
    } catch (err) {
      if (err?.code === 'CUSTOMER_PHONE_CONFLICT' || err?.code === 'REP_PHONE_CONFLICT') {
        await recordAuditLog({
          userId: null,
          userName: fullName,
          action:
            err.code === 'REP_PHONE_CONFLICT'
              ? `رفض تسجيل ذاتي لتعارض رقم هاتف مندوب (${phone})`
              : `رفض تسجيل ذاتي لتعارض رقم هاتف عميل (${phone})`,
          module: 'المصادقة',
          recordId: cleanDeviceId || username,
          notes: err.message,
          ipAddress: meta.ipAddress,
          deviceInfo: meta.deviceInfo,
        });
        throw err;
      }
      if (scopedIdem && (err?.code === 'DUPLICATE_USERNAME' || err?.code === '23505')) {
        const racedDup = await findPgIdempotency(getPool(), scopedIdem);
        if (racedDup?.response && racedDup.payloadDigest === payloadDigest) {
          return racedDup.response;
        }
      }
      if (err?.code === '23505') {
        const constraint = String(err?.constraint || '').toLowerCase();
        const detail = String(err?.detail || err?.message || '').toLowerCase();
        if (constraint.includes('norm_phone') || detail.includes('normalized_phone')) {
          throw new AppError(
            409,
            role === 'representative' ? REP_PHONE_CONFLICT_WARNING : CUSTOMER_PHONE_CONFLICT_WARNING,
            role === 'representative' ? 'REP_PHONE_CONFLICT' : 'CUSTOMER_PHONE_CONFLICT'
          );
        }
        throw new AppError(409, 'اسم المستخدم مسجل مسبقًا، يرجى اختيار اسم آخر أو تسجيل الدخول', 'DUPLICATE_USERNAME');
      }
      throw err;
    }

    if (result.deduplicated) {
      return result.response;
    }

    await recordAuditLog({
      userId: result.user.id,
      userName: result.user.fullName,
      action: `تسجيل ذاتي لحساب ${role === 'representative' ? 'مندوب' : 'عميل'} (${result.user.username})`,
      module: 'المصادقة',
      recordId: result.user.id,
      ipAddress: meta.ipAddress,
      deviceInfo: meta.deviceInfo,
    });

    return result.response;
  }

  // JSON Ledger mode
  let found;
  try {
    found = await withJsonTransaction(async (db) => {
      if (scopedIdem) {
        const dup = findJsonIdempotency(scopedIdem);
        if (dup?.response && dup.payloadDigest === payloadDigest) {
          return { deduplicated: true, response: dup.response };
        }
      }

      if ((db.users || []).some((u) => String(u.username || '').toLowerCase() === cleanUsernameLower)) {
        throw new AppError(409, 'اسم المستخدم مسجل مسبقًا، يرجى اختيار اسم آخر أو تسجيل الدخول', 'DUPLICATE_USERNAME');
      }
      if (normPhone && (db.users || []).some((u) => u.role === role && normalizeRegPhone(u.phone) === normPhone)) {
        throw new AppError(
          409,
          role === 'representative' ? REP_PHONE_CONFLICT_WARNING : CUSTOMER_PHONE_CONFLICT_WARNING,
          role === 'representative' ? 'REP_PHONE_CONFLICT' : 'CUSTOMER_PHONE_CONFLICT'
        );
      }

      let customerProfile = null;
      let representativeProfile = null;
      const userNotes = 'حساب مسجل ذاتيًا عبر الموبايل';

      if (role === 'customer') {
        const allMatches = normPhone
          ? (db.customers || []).filter((c) => customerHasRegPhone(c, normPhone))
          : [];
        const hasAlreadyLinkedMatch = allMatches.some((c) => Boolean(c.userId));
        if (allMatches.length > 1 || hasAlreadyLinkedMatch) {
          throw new AppError(409, CUSTOMER_PHONE_CONFLICT_WARNING, 'CUSTOMER_PHONE_CONFLICT');
        }
      } else {
        const repMatches = normPhone
          ? (db.representatives || []).filter((r) => normalizeRegPhone(r.phone) === normPhone)
          : [];
        const hasAlreadyLinkedRep = repMatches.some((r) => Boolean(r.userId));
        if (repMatches.length > 1 || hasAlreadyLinkedRep) {
          throw new AppError(409, REP_PHONE_CONFLICT_WARNING, 'REP_PHONE_CONFLICT');
        }
      }

      const livePermissions = resolveDefaultPermissionsForRole(role, db.settings?.extraSettings || {});
      const newUser = {
        id: userId,
        fullName,
        username,
        passwordHash,
        passwordAlgo: 'bcrypt',
        phone,
        address,
        notes: userNotes,
        role,
        jobTitle: role === 'representative' ? 'مندوب مبيعات' : 'عميل',
        department: role === 'representative' ? 'المندوبون' : 'العملاء',
        isActive: true,
        mustChangePassword: false,
        permissions: livePermissions,
        shortcuts: [],
        createdAt: now,
      };
      db.users.push(newUser);

      if (role === 'customer') {
      const unlinkedMatches = normPhone
        ? (db.customers || []).filter((c) => !c.userId && customerHasRegPhone(c, normPhone))
        : [];
      if (unlinkedMatches.length === 1) {
        const target = unlinkedMatches[0];
        target.userId = userId;
        if (shopName) target.shopName = shopName;
        if (safeShopPhoto) {
          target.shopPhoto = safeShopPhoto;
          target.photo = safeShopPhoto;
        }
        if (address) target.address = address;
        if (governorate) target.governorate = governorate;
        if (area) target.area = area;
        if (geoCoordinates) target.geoCoordinates = geoCoordinates;
        target.phones = normalizeCustomerPhonesList(target.phones, phone || target.phone || '', target.secondaryPhone || '');
        target.updatedAt = now;
        customerProfile = target;
      } else {
        const custId = generateServerId('CUS');
        const custCode = `CUS-${String(Date.now()).slice(-5)}-${Math.floor(10 + Math.random() * 89)}`;
        const initialPhones = regPhones.length > 0 ? regPhones : normalizeCustomerPhonesList([], phone, '');
        const primaryRegPhone = initialPhones.find((p) => p.isPrimary)?.number || initialPhones[0]?.number || phone;
        const secondaryRegPhone = initialPhones.find((p) => !p.isPrimary && p.number !== primaryRegPhone)?.number || undefined;
        customerProfile = {
          id: custId,
          code: custCode,
          userId,
          name: fullName,
          phone: primaryRegPhone,
          secondaryPhone: secondaryRegPhone,
          phones: initialPhones,
          shopName: shopName || undefined,
          shopPhoto: safeShopPhoto || undefined,
          photo: safeShopPhoto || undefined,
          address,
          governorate: governorate || undefined,
          area: area || undefined,
          geoCoordinates: geoCoordinates || undefined,
          openingBalance: 0,
          currentBalance: 0,
          priceHistory: {},
          notes: 'عميل مسجل ذاتيًا عبر التطبيق',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
        db.customers.unshift(customerProfile);
      }
    } else if (role === 'representative') {
      const unlinkedRepMatches = normPhone
        ? (db.representatives || []).filter((r) => !r.userId && normalizeRegPhone(r.phone) === normPhone)
        : [];
      if (unlinkedRepMatches.length === 1) {
        const targetRep = unlinkedRepMatches[0];
        if (!targetRep.warehouseId) {
          const vanId = generateServerId('WH');
          const vanCode = `VAN-${String(Date.now()).slice(-4)}-${Math.floor(10 + Math.random() * 89)}`;
          const vanName = `سيارة المندوب - ${targetRep.name || fullName}`;
          db.warehouses.push({
            id: vanId,
            name: vanName,
            code: vanCode,
            location: 'مخزون سيارة مندوب',
            managerName: targetRep.name || fullName,
            phone,
            isDefault: false,
            status: 'active',
          });
          targetRep.warehouseId = vanId;
        }
        targetRep.userId = userId;
        if (!targetRep.phone && phone) targetRep.phone = phone;
        if (!targetRep.vehicleNumber && vehicleNumber) targetRep.vehicleNumber = vehicleNumber;
        representativeProfile = targetRep;
      } else {
        const vanId = generateServerId('WH');
        const vanCode = `VAN-${String(Date.now()).slice(-4)}-${Math.floor(10 + Math.random() * 89)}`;
        const vanName = `سيارة المندوب - ${fullName}`;
        db.warehouses.push({
          id: vanId,
          name: vanName,
          code: vanCode,
          location: 'مخزون سيارة مندوب',
          managerName: fullName,
          phone,
          isDefault: false,
          status: 'active',
        });
        const repId = generateServerId('REP');
        representativeProfile = {
          id: repId,
          userId,
          name: fullName,
          phone,
          vehicleNumber,
          warehouseId: vanId,
          openingBalance: 0,
          currentBalance: 0,
          commissionRate: 0,
          notes: 'مندوب مسجل ذاتيًا عبر التطبيق',
          status: 'active',
        };
        db.representatives.unshift(representativeProfile);
      }
    }

    if (cleanDeviceId) {
      db.pairedDevices = db.pairedDevices || [];
      const existingDev = db.pairedDevices.find((d) => d.deviceId === cleanDeviceId);
      if (existingDev) {
        existingDev.linkedUserId = userId;
        existingDev.linkedUserName = fullName;
        existingDev.lastSeenAt = now;
      } else {
        const inferredType =
          payload.deviceType || (/iphone|ipad/i.test(meta.deviceInfo || '') ? 'ios' : /android/i.test(meta.deviceInfo || '') ? 'android' : 'web');
        db.pairedDevices.unshift({
          deviceId: cleanDeviceId,
          deviceName: payload.deviceName || `${fullName} (${inferredType})`,
          deviceType: inferredType,
          linkedUserId: userId,
          linkedUserName: fullName,
          connectionMode: 'local_network',
          serverUrlUsed: payload.serverUrlUsed || '',
          ipAddress: meta.ipAddress || '',
          status: 'active',
          configVersion: 1,
          pairedAt: now,
          lastSeenAt: now,
        });
      }
    }

    const sessions = readJsonSessions().filter((s) => !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now());
    sessions.push({
      id: sessionId,
      userId: newUser.id,
      installationId,
      refreshTokenHash: refreshHash,
      deviceInfo: meta.deviceInfo || '',
      deviceId: cleanDeviceId || '',
      ipAddress: meta.ipAddress || '',
      expiresAt: expiresDate,
      revokedAt: null,
      createdAt: now,
    });
    writeJsonSessions(sessions);

    const sharedIdentityIdJson = attachRecordToIdentityJsonTx(db, {
      entityType: 'user',
      entityId: newUser.id,
      roleKey: 'user',
      fullName,
      phone,
      address,
      explicitIdentityId:
        customerProfile?.identityId ||
        representativeProfile?.identityId ||
        null,
      isPrimary: true,
      now,
    });
    newUser.identityId = sharedIdentityIdJson;
    if (customerProfile?.id) {
      attachRecordToIdentityJsonTx(db, {
        entityType: 'customer',
        entityId: customerProfile.id,
        roleKey: 'customer',
        fullName: customerProfile.name || fullName,
        phone: customerProfile.phone || phone,
        address: customerProfile.address || address,
        explicitIdentityId: sharedIdentityIdJson,
        now,
      });
    }
    if (representativeProfile?.id) {
      attachRecordToIdentityJsonTx(db, {
        entityType: 'representative',
        entityId: representativeProfile.id,
        roleKey: 'representative',
        fullName: representativeProfile.name || fullName,
        phone: representativeProfile.phone || phone,
        address: address || '',
        explicitIdentityId: sharedIdentityIdJson,
        now,
      });
    }
    const idCtxJson = resolveIdentityContextForUserJson(db, newUser);

    const accessToken = signJwt(
      {
        sub: newUser.id,
        role: newUser.role,
        sid: sessionId,
        did: cleanDeviceId || null,
        iid: installationId,
        cid: customerProfile?.id || null,
        rid: representativeProfile?.id || null,
      },
      ACCESS_TOKEN_TTL_SEC
    );
    const response = {
      installationId,
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SEC,
      user: sanitizeUserForRole(newUser),
      identityId: idCtxJson.identityId,
      employeeId: idCtxJson.employeeId,
      linkedRoles: idCtxJson.linkedRoles,
      customerProfile,
      representativeProfile,
      linkWarning: null,
    };

    if (scopedIdem) {
      saveJsonIdempotency(scopedIdem, { payloadDigest, response });
    }

    return { deduplicated: false, user: newUser, response };
    });
  } catch (err) {
    if (err?.code === 'CUSTOMER_PHONE_CONFLICT' || err?.code === 'REP_PHONE_CONFLICT') {
      await recordAuditLog({
        userId: null,
        userName: fullName,
        action:
          err.code === 'REP_PHONE_CONFLICT'
            ? `رفض تسجيل ذاتي لتعارض رقم هاتف مندوب (${phone})`
            : `رفض تسجيل ذاتي لتعارض رقم هاتف عميل (${phone})`,
        module: 'المصادقة',
        recordId: cleanDeviceId || username,
        notes: err.message,
        ipAddress: meta.ipAddress,
        deviceInfo: meta.deviceInfo,
      });
    }
    throw err;
  }

  if (found.deduplicated) {
    return found.response;
  }

  await recordAuditLog({
    userId: found.user.id,
    userName: found.user.fullName,
    action: `تسجيل ذاتي لحساب ${role === 'representative' ? 'مندوب' : 'عميل'} (${found.user.username})`,
    module: 'المصادقة',
    recordId: found.user.id,
    ipAddress: meta.ipAddress,
    deviceInfo: meta.deviceInfo,
  });

  return found.response;
  });
}

export async function refreshUserSession({ refreshToken, deviceId = '', deviceInfo = '', ipAddress = '' }) {
  if (!refreshToken) {
    throw new AppError(401, 'رمز التحديث مفقود', 'MISSING_REFRESH_TOKEN');
  }
  const cleanDeviceId = String(deviceId || '').trim().slice(0, 64);
  const hash = sha256Hex(refreshToken);
  const newRefresh = generateRefreshToken();
  const newRefreshHash = sha256Hex(newRefresh);
  const newExpires = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400 * 1000).toISOString();

  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      const sesRes = await client.query(
        `SELECT * FROM user_sessions WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1 FOR UPDATE`,
        [hash]
      );
      const ses = sesRes.rows[0];
      if (!ses) {
        throw new AppError(401, 'انتهت صلاحية الجلسة أو تم إلغاؤها', 'INVALID_SESSION');
      }

      const effectiveDeviceId = cleanDeviceId || ses.device_id || '';
      if (effectiveDeviceId) {
        await checkDeviceAuthGuardInternal(effectiveDeviceId, client);
      }

      const uRes = await client.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [ses.user_id]);
      const userRow = uRes.rows[0];
      if (!userRow || !userRow.is_active) {
        throw new AppError(403, 'الحساب غير نشط', 'ACCOUNT_SUSPENDED');
      }

      await client.query(
        `UPDATE user_sessions SET refresh_token_hash = $1, expires_at = $2, device_info = COALESCE(NULLIF($3, ''), device_info), ip_address = COALESCE(NULLIF($4, ''), ip_address), device_id = COALESCE(NULLIF($5, ''), device_id) WHERE id = $6`,
        [newRefreshHash, newExpires, deviceInfo, ipAddress, effectiveDeviceId, ses.id]
      );

      const user = mapPgUserRow(userRow);
      const profiles = await resolveLinkedProfilesPg(client, user);
      return { sessionId: ses.id, effectiveDeviceId, user, ...profiles };
    });

    const installationId = await ensureInstallationId();
    const accessToken = signJwt(
      {
        sub: result.user.id,
        role: result.user.role,
        sid: result.sessionId,
        did: result.effectiveDeviceId || null,
        iid: installationId,
        cid: result.customerProfile?.id || null,
        rid: result.representativeProfile?.id || null,
      },
      ACCESS_TOKEN_TTL_SEC
    );

    const refreshedUser = {
      ...result.user,
      identityId: result.user.identityId || result.identityId,
      employeeId: result.user.employeeId || result.employeeId,
    };

    return {
      installationId,
      accessToken,
      refreshToken: newRefresh,
      expiresIn: ACCESS_TOKEN_TTL_SEC,
      user: sanitizeUserForRole(refreshedUser),
      identityId: refreshedUser.identityId,
      employeeId: refreshedUser.employeeId,
      linkedRoles: result.linkedRoles || [],
      customerProfile: result.customerProfile,
      representativeProfile: result.representativeProfile,
      linkWarning: result.linkWarning,
    };
  }

  // JSON Ledger mode
  const installationId = await ensureInstallationId();
  const sesFound = await withJsonMutex(async () => {
    const sessions = readJsonSessions();
    const idx = sessions.findIndex(
      (s) => s.refreshTokenHash === hash && !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now()
    );
    if (idx === -1) {
      throw new AppError(401, 'انتهت صلاحية الجلسة أو تم إلغاؤها', 'INVALID_SESSION');
    }
    if (sessions[idx].installationId && sessions[idx].installationId !== installationId) {
      throw new AppError(401, 'الجلسة غير تابعة لهذا الخادم أو لهذه الشركة', 'INVALID_SESSION');
    }
    const effectiveDeviceId = cleanDeviceId || sessions[idx].deviceId || '';
    if (effectiveDeviceId) {
      await checkDeviceAuthGuardInternal(effectiveDeviceId);
    }
    const db = readJsonDatabase();
    const user = db.users.find((u) => u.id === sessions[idx].userId);
    if (!user || !user.isActive) {
      throw new AppError(403, 'الحساب غير نشط', 'ACCOUNT_SUSPENDED');
    }
    sessions[idx].refreshTokenHash = newRefreshHash;
    sessions[idx].expiresAt = newExpires;
    sessions[idx].installationId = installationId;
    if (effectiveDeviceId) sessions[idx].deviceId = effectiveDeviceId;
    writeJsonSessions(sessions);
    const profiles = resolveLinkedProfilesJson(db, user);
    return { sessionId: sessions[idx].id, effectiveDeviceId, user, ...profiles };
  });

  const accessToken = signJwt(
    {
      sub: sesFound.user.id,
      role: sesFound.user.role,
      sid: sesFound.sessionId,
      did: sesFound.effectiveDeviceId || null,
      iid: installationId,
      cid: sesFound.customerProfile?.id || null,
      rid: sesFound.representativeProfile?.id || null,
    },
    ACCESS_TOKEN_TTL_SEC
  );

  const refreshedJsonUser = {
    ...sesFound.user,
    identityId: sesFound.user.identityId || sesFound.identityId,
    employeeId: sesFound.user.employeeId || sesFound.employeeId,
  };

  return {
    installationId,
    accessToken,
    refreshToken: newRefresh,
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    user: sanitizeUserForRole(refreshedJsonUser),
    identityId: refreshedJsonUser.identityId,
    employeeId: refreshedJsonUser.employeeId,
    linkedRoles: sesFound.linkedRoles || [],
    customerProfile: sesFound.customerProfile,
    representativeProfile: sesFound.representativeProfile,
    linkWarning: sesFound.linkWarning,
  };
}

export async function logoutSession({ sessionId = null, refreshToken = null }) {
  const now = nowIso();
  const hash = refreshToken ? sha256Hex(refreshToken) : null;

  if (await isPgMode()) {
    const pool = getPool();
    if (sessionId) {
      await pool.query(`UPDATE user_sessions SET revoked_at = $1 WHERE id = $2`, [now, sessionId]);
    } else if (hash) {
      await pool.query(`UPDATE user_sessions SET revoked_at = $1 WHERE refresh_token_hash = $2`, [now, hash]);
    }
    return { ok: true };
  }

  await withJsonMutex(() => {
    const sessions = readJsonSessions();
    let changed = false;
    for (const s of sessions) {
      if ((sessionId && s.id === sessionId) || (hash && s.refreshTokenHash === hash)) {
        s.revokedAt = now;
        changed = true;
      }
    }
    if (changed) writeJsonSessions(sessions);
  });
  return { ok: true };
}

export async function validateActiveSession(sessionId, userId, tokenInstallationId = null) {
  const installationId = await ensureInstallationId();
  if (!tokenInstallationId || tokenInstallationId !== installationId) {
    return null;
  }

  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(
      `SELECT u.*, s.id AS session_id, s.device_id AS session_device_id
       FROM users u
       JOIN user_sessions s ON s.user_id = u.id
       WHERE u.id = $1 AND s.id = $2 AND s.revoked_at IS NULL AND s.expires_at > NOW()
       LIMIT 1`,
      [userId, sessionId]
    );
    const row = res.rows[0];
    if (!row || !row.is_active) return null;
    const user = mapPgUserRow(row);
    const profiles = await resolveLinkedProfilesPg(pool, user);
    const validatedUser = {
      ...user,
      identityId: user.identityId || profiles.identityId,
      employeeId: user.employeeId || profiles.employeeId,
    };
    return {
      installationId,
      user: sanitizeUserForRole(validatedUser),
      rawUser: validatedUser,
      identityId: validatedUser.identityId,
      employeeId: validatedUser.employeeId,
      linkedRoles: profiles.linkedRoles || [],
      deviceId: row.session_device_id || '',
      customerProfile: profiles.customerProfile,
      representativeProfile: profiles.representativeProfile,
      linkWarning: profiles.linkWarning,
    };
  }

  const sessions = readJsonSessions();
  const ses = sessions.find(
    (s) =>
      s.id === sessionId &&
      s.userId === userId &&
      !s.revokedAt &&
      new Date(s.expiresAt).getTime() > Date.now() &&
      (!s.installationId || s.installationId === installationId)
  );
  if (!ses) return null;
  const db = readJsonDatabase();
  const user = db.users.find((u) => u.id === userId);
  if (!user || !user.isActive) return null;
  const profiles = resolveLinkedProfilesJson(db, user);
  const validatedJsonUser = {
    ...user,
    identityId: user.identityId || profiles.identityId,
    employeeId: user.employeeId || profiles.employeeId,
  };
  return {
    installationId,
    user: sanitizeUserForRole(validatedJsonUser),
    rawUser: validatedJsonUser,
    identityId: validatedJsonUser.identityId,
    employeeId: validatedJsonUser.employeeId,
    linkedRoles: profiles.linkedRoles || [],
    deviceId: ses.deviceId || '',
    customerProfile: profiles.customerProfile,
    representativeProfile: profiles.representativeProfile,
    linkWarning: profiles.linkWarning,
  };
}

export async function changeOwnPassword({ userId, currentPassword, newPassword }, meta = {}) {
  const cleanNew = String(newPassword || '');
  if (cleanNew.length < 6) {
    throw new AppError(400, 'كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف', 'WEAK_PASSWORD');
  }
  const newHash = await hashPasswordBcrypt(cleanNew);
  const now = nowIso();

  if (await isPgMode()) {
    const user = await withTransaction(async (client) => {
      const res = await client.query(`SELECT * FROM users WHERE id = $1 LIMIT 1 FOR UPDATE`, [userId]);
      const row = res.rows[0];
      if (!row) throw new AppError(404, 'المستخدم غير موجود', 'USER_NOT_FOUND');

      if (!row.must_change_password) {
        const { valid } = await verifyPasswordAndCheckUpgrade(currentPassword, row.password_hash);
        if (!valid) throw new AppError(401, 'كلمة المرور الحالية غير صحيحة', 'WRONG_CURRENT_PASSWORD');
      } else if (currentPassword) {
        const { valid } = await verifyPasswordAndCheckUpgrade(currentPassword, row.password_hash);
        if (!valid) throw new AppError(401, 'كلمة المرور الحالية غير صحيحة', 'WRONG_CURRENT_PASSWORD');
      }

      await client.query(
        `UPDATE users SET password_hash = $1, password_algo = 'bcrypt', must_change_password = FALSE, updated_at = $2 WHERE id = $3`,
        [newHash, now, userId]
      );
      return mapPgUserRow(row);
    });

    await recordAuditLog({
      userId: user.id,
      userName: user.fullName,
      action: 'تغيير كلمة المرور الشخصية',
      module: 'المصادقة',
      recordId: user.id,
      ipAddress: meta.ipAddress,
      deviceInfo: meta.deviceInfo,
    });
    return { ok: true };
  }

  const user = await withJsonTransaction(async (db) => {
    const u = db.users.find((x) => x.id === userId);
    if (!u) throw new AppError(404, 'المستخدم غير موجود', 'USER_NOT_FOUND');

    if (!u.mustChangePassword || currentPassword) {
      const { valid } = await verifyPasswordAndCheckUpgrade(currentPassword, u.passwordHash);
      if (!valid) throw new AppError(401, 'كلمة المرور الحالية غير صحيحة', 'WRONG_CURRENT_PASSWORD');
    }
    u.passwordHash = newHash;
    u.passwordAlgo = 'bcrypt';
    u.mustChangePassword = false;
    return u;
  });

  await recordAuditLog({
    userId: user.id,
    userName: user.fullName,
    action: 'تغيير كلمة المرور الشخصية',
    module: 'المصادقة',
    recordId: user.id,
    ipAddress: meta.ipAddress,
    deviceInfo: meta.deviceInfo,
  });
  return { ok: true };
}

function normalizeUserShortcutsList(rawShortcuts) {
  if (!Array.isArray(rawShortcuts)) {
    throw new AppError(400, 'صيغة اختصارات لوحة المفاتيح غير صالحة', 'INVALID_SHORTCUTS');
  }
  const seenActions = new Set();
  const seenCombos = new Map();
  const normalized = [];

  for (const item of rawShortcuts) {
    if (!item || typeof item !== 'object') continue;
    const actionId = String(item.actionId || '').trim();
    const keyCombo = String(item.keyCombo || '').trim();
    if (!actionId) continue;
    if (seenActions.has(actionId)) {
      throw new AppError(400, `الوظيفة (${actionId}) مكررة في قائمة الاختصارات`, 'DUPLICATE_SHORTCUT_ACTION');
    }
    seenActions.add(actionId);
    const enabled = item.enabled !== false && Boolean(keyCombo);
    const comboKey = keyCombo.toUpperCase();
    if (enabled && comboKey) {
      if (seenCombos.has(comboKey)) {
        throw new AppError(
          409,
          `الاختصار (${keyCombo}) مستخدم بالفعل في وظيفة أخرى (${seenCombos.get(comboKey)})`,
          'SHORTCUT_CONFLICT'
        );
      }
      seenCombos.set(comboKey, String(item.label || actionId));
    }
    normalized.push({
      id: String(item.id || `SC-${actionId}`).trim(),
      actionId,
      label: String(item.label || actionId).trim(),
      category: String(item.category || 'عام').trim(),
      keyCombo,
      enabled: item.enabled !== false,
    });
  }
  return normalized;
}

export async function getOwnShortcuts(userId) {
  if (await isPgMode()) {
    const res = await getPool().query('SELECT shortcuts FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (!res.rows[0]) throw new AppError(404, 'المستخدم غير موجود', 'USER_NOT_FOUND');
    return Array.isArray(res.rows[0].shortcuts) ? res.rows[0].shortcuts : [];
  }
  const db = readJsonDatabase();
  const u = db.users.find((x) => x.id === userId);
  if (!u) throw new AppError(404, 'المستخدم غير موجود', 'USER_NOT_FOUND');
  return Array.isArray(u.shortcuts) ? u.shortcuts : [];
}

export async function updateOwnShortcuts(userId, rawShortcuts, meta = {}) {
  const shortcuts = normalizeUserShortcutsList(rawShortcuts);
  const now = nowIso();

  if (await isPgMode()) {
    const user = await withTransaction(async (client) => {
      const res = await client.query('SELECT * FROM users WHERE id = $1 LIMIT 1 FOR UPDATE', [userId]);
      if (!res.rows[0]) throw new AppError(404, 'المستخدم غير موجود', 'USER_NOT_FOUND');
      await client.query('UPDATE users SET shortcuts = $1, updated_at = $2 WHERE id = $3', [
        JSON.stringify(shortcuts),
        now,
        userId,
      ]);
      const next = await client.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
      return sanitizeUserForRole(mapPgUserRow(next.rows[0]));
    });
    await recordAuditLog({
      userId: user.id,
      userName: user.fullName,
      action: `تحديث اختصارات لوحة المفاتيح الشخصية (${shortcuts.length} اختصار)`,
      module: 'الإعدادات والاختصارات',
      recordId: user.id,
      ipAddress: meta.ipAddress,
      deviceInfo: meta.deviceInfo,
    });
    return { shortcuts, user };
  }

  const user = await withJsonTransaction(async (db) => {
    const u = db.users.find((x) => x.id === userId);
    if (!u) throw new AppError(404, 'المستخدم غير موجود', 'USER_NOT_FOUND');
    u.shortcuts = shortcuts;
    return sanitizeUserForRole(u);
  });
  await recordAuditLog({
    userId: user.id,
    userName: user.fullName,
    action: `تحديث اختصارات لوحة المفاتيح الشخصية (${shortcuts.length} اختصار)`,
    module: 'الإعدادات والاختصارات',
    recordId: user.id,
    ipAddress: meta.ipAddress,
    deviceInfo: meta.deviceInfo,
  });
  return { shortcuts, user };
}

export async function revokeAllUserSessions(userId) {
  if (!userId) return;
  const now = nowIso();
  if (await isPgMode()) {
    await getPool().query('UPDATE user_sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL', [now, userId]);
    return;
  }
  await withJsonMutex(() => {
    const sessions = readJsonSessions();
    let changed = false;
    for (const s of sessions) {
      if (s.userId === userId && !s.revokedAt) {
        s.revokedAt = now;
        changed = true;
      }
    }
    if (changed) writeJsonSessions(sessions);
  });
}

export async function revokeSessionsByDeviceId(deviceId) {
  const cleanId = String(deviceId || '').trim();
  if (!cleanId) return;
  const now = nowIso();
  if (await isPgMode()) {
    await getPool().query('UPDATE user_sessions SET revoked_at = $1 WHERE device_id = $2 AND revoked_at IS NULL', [now, cleanId]);
    return;
  }
  await withJsonMutex(() => {
    const sessions = readJsonSessions();
    let changed = false;
    for (const s of sessions) {
      if (s.deviceId === cleanId && !s.revokedAt) {
        s.revokedAt = now;
        changed = true;
      }
    }
    if (changed) writeJsonSessions(sessions);
  });
}



import { getPool, withTransaction } from '../postgres.js';
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
import { AppError, nowIso, sanitizeUser } from '../../utils/errors.js';
import {
  isPgMode,
  FULL_ADMIN_PERMISSIONS,
  mapPgUserRow,
  mapPgCustomerRow,
  isoTimestamp,
} from './mode.js';

const ACCESS_TOKEN_TTL_SEC = 900; // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 30;

export async function recordAuditLog({
  userId = null,
  userName = 'النظام',
  action,
  module,
  recordId = null,
  oldValues = null,
  newValues = null,
  ipAddress = '',
  deviceInfo = '',
  notes = '',
}) {
  const id = generateServerId('AUD');
  const timestamp = nowIso();
  const detailsText =
    notes ||
    (newValues && typeof newValues === 'object' ? JSON.stringify(newValues) : String(action || ''));

  if (await isPgMode()) {
    const pool = getPool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO audit_logs (id, timestamp, user_id, user_name, action, module, record_id, old_values, new_values, ip_address, device_info, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            id,
            timestamp,
            userId,
            userName,
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
        console.error('[AuditLog PG Error]:', err.message);
      }
    }
  } else {
    await appendJsonAuditLog({
      id,
      timestamp,
      userId: userId || 'system',
      userName,
      action,
      module,
      recordId: recordId || undefined,
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
    action,
    module,
    recordId: recordId || undefined,
    details: detailsText,
  };
}

export async function listAuditLogs(limit = 300) {
  const safeLimit = Math.min(2000, Math.max(1, Number(limit) || 300));
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(
      `SELECT id, timestamp, user_id, user_name, action, module, record_id, notes, new_values
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
      details: r.notes || (r.new_values ? JSON.stringify(r.new_values) : r.action),
    }));
  }
  return readJsonAuditLogs().slice(0, safeLimit);
}

export async function getAuthStatus() {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT COUNT(*)::int AS cnt FROM users');
    const count = Number(res.rows[0]?.cnt || 0);
    return {
      needsAdminSetup: count === 0,
      usersCount: count,
      mode: 'postgresql-enterprise',
    };
  }
  const db = readJsonDatabase();
  const count = Array.isArray(db.users) ? db.users.length : 0;
  return {
    needsAdminSetup: count === 0,
    usersCount: count,
    mode: 'local-json-ledger',
  };
}

export async function bootstrapAdmin({ fullName, username, password, phone = '', companyName = '' }, meta = {}) {
  const cleanUser = String(username || '').trim();
  const cleanName = String(fullName || '').trim();
  const cleanPass = String(password || '');
  if (!cleanUser || cleanUser.length < 3) {
    throw new AppError(400, 'اسم المستخدم يجب أن لا يقل عن 3 أحرف', 'INVALID_USERNAME');
  }
  if (!cleanName || cleanName.length < 2) {
    throw new AppError(400, 'يرجى إدخال الاسم الكامل للمسؤول', 'INVALID_NAME');
  }
  if (!cleanPass || cleanPass.length < 6) {
    throw new AppError(400, 'كلمة المرور يجب أن لا تقل عن 6 أحرف', 'WEAK_PASSWORD');
  }

  const passwordHash = await hashPasswordBcrypt(cleanPass);
  const adminId = generateServerId('USR');
  const now = nowIso();

  if (await isPgMode()) {
    const created = await withTransaction(async (client) => {
      const existing = await client.query('SELECT COUNT(*)::int AS cnt FROM users');
      if (Number(existing.rows[0]?.cnt || 0) > 0) {
        throw new AppError(403, 'تم تهيئة حساب المدير مسبقًا. استخدم تسجيل الدخول.', 'ALREADY_BOOTSTRAPPED');
      }

      await client.query(
        `INSERT INTO users (id, full_name, username, password_hash, password_algo, phone, role, job_title, department, is_active, must_change_password, permissions, created_at)
         VALUES ($1, $2, $3, $4, 'bcrypt', $5, 'admin', 'المدير العام', 'الإدارة', TRUE, FALSE, $6, $7)`,
        [adminId, cleanName, cleanUser, passwordHash, phone || '', JSON.stringify(FULL_ADMIN_PERMISSIONS), now]
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

      const stCheck = await client.query('SELECT COUNT(*)::int AS cnt FROM system_settings');
      if (Number(stCheck.rows[0]?.cnt || 0) === 0) {
        await client.query(
          `INSERT INTO system_settings (id, company_name, company_subtitle, currency, default_print_mode, invoice_notes, allow_negative_stock)
           VALUES ('default', $1, 'نظام المحاسبة وإدارة الأعمال المتكامل', 'ج.م', 'a4', 'شكرًا لتعاملكم معنا', FALSE)`,
          [companyName || 'مؤسسة أولاد سليم للتجارة والتوزيع']
        );
      }

      const uRes = await client.query('SELECT * FROM users WHERE id = $1', [adminId]);
      return mapPgUserRow(uRes.rows[0]);
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

    return sanitizeUser(created);
  }

  const created = await withJsonTransaction(async (db) => {
    if (db.users.length > 0) {
      throw new AppError(403, 'تم تهيئة حساب المدير مسبقًا. استخدم تسجيل الدخول.', 'ALREADY_BOOTSTRAPPED');
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
    if (companyName) db.settings.companyName = companyName;
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

  return sanitizeUser(created);
}

async function resolveLinkedProfilesPg(clientOrPool, user) {
  let customerProfile = null;
  let representativeProfile = null;
  let linkWarning = null;

  if (user.role === 'customer') {
    const custRes = await clientOrPool.query('SELECT * FROM customers WHERE user_id = $1 LIMIT 1', [user.id]);
    if (custRes.rows[0]) {
      customerProfile = mapPgCustomerRow(custRes.rows[0]);
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
    }
  }

  return { customerProfile, representativeProfile, linkWarning };
}

function resolveLinkedProfilesJson(db, user) {
  let customerProfile = null;
  let representativeProfile = null;
  let linkWarning = null;

  if (user.role === 'customer') {
    const cust = db.customers.find((c) => c.userId === user.id);
    if (cust) {
      customerProfile = cust;
    } else {
      linkWarning = 'حساب العميل غير مربوط بملف عميل في الدليل. يرجى التواصل مع الإدارة لإتمام الربط.';
    }
  } else if (user.role === 'representative') {
    const rep = db.representatives.find((r) => r.userId === user.id);
    if (rep) {
      representativeProfile = rep;
    }
  }

  return { customerProfile, representativeProfile, linkWarning };
}

export async function loginUser({ username, password, deviceInfo = '', ipAddress = '' }) {
  const cleanUsername = String(username || '').trim().toLowerCase();
  const cleanPassword = String(password || '');
  if (!cleanUsername || !cleanPassword) {
    throw new AppError(400, 'يرجى إدخال اسم المستخدم وكلمة المرور', 'MISSING_CREDENTIALS');
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
        `INSERT INTO user_sessions (id, user_id, refresh_token_hash, device_info, ip_address, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sessionId, row.id, refreshHash, deviceInfo || '', ipAddress || '', expiresDate, now]
      );

      const userObj = mapPgUserRow(row);
      userObj.lastLogin = now;
      const profiles = await resolveLinkedProfilesPg(client, userObj);
      return { user: userObj, ...profiles };
    });

    const accessToken = signJwt(
      {
        sub: result.user.id,
        role: result.user.role,
        sid: sessionId,
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

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SEC,
      user: sanitizeUser(result.user),
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
    const profiles = resolveLinkedProfilesJson(db, user);
    return { user: structuredClone(user), ...profiles };
  });

  await withJsonMutex(async () => {
    const sessions = readJsonSessions().filter((s) => !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now());
    sessions.push({
      id: sessionId,
      userId: found.user.id,
      refreshTokenHash: refreshHash,
      deviceInfo: deviceInfo || '',
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

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    user: sanitizeUser(found.user),
    customerProfile: found.customerProfile,
    representativeProfile: found.representativeProfile,
    linkWarning: found.linkWarning,
  };
}

export async function refreshUserSession({ refreshToken, deviceInfo = '', ipAddress = '' }) {
  if (!refreshToken) {
    throw new AppError(401, 'رمز التحديث مفقود', 'MISSING_REFRESH_TOKEN');
  }
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

      const uRes = await client.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [ses.user_id]);
      const userRow = uRes.rows[0];
      if (!userRow || !userRow.is_active) {
        throw new AppError(403, 'الحساب غير نشط', 'ACCOUNT_SUSPENDED');
      }

      await client.query(
        `UPDATE user_sessions SET refresh_token_hash = $1, expires_at = $2, device_info = COALESCE(NULLIF($3, ''), device_info), ip_address = COALESCE(NULLIF($4, ''), ip_address) WHERE id = $5`,
        [newRefreshHash, newExpires, deviceInfo, ipAddress, ses.id]
      );

      const user = mapPgUserRow(userRow);
      const profiles = await resolveLinkedProfilesPg(client, user);
      return { sessionId: ses.id, user, ...profiles };
    });

    const accessToken = signJwt(
      {
        sub: result.user.id,
        role: result.user.role,
        sid: result.sessionId,
        cid: result.customerProfile?.id || null,
        rid: result.representativeProfile?.id || null,
      },
      ACCESS_TOKEN_TTL_SEC
    );

    return {
      accessToken,
      refreshToken: newRefresh,
      expiresIn: ACCESS_TOKEN_TTL_SEC,
      user: sanitizeUser(result.user),
      customerProfile: result.customerProfile,
      representativeProfile: result.representativeProfile,
      linkWarning: result.linkWarning,
    };
  }

  // JSON Ledger mode
  const sesFound = await withJsonMutex(async () => {
    const sessions = readJsonSessions();
    const idx = sessions.findIndex(
      (s) => s.refreshTokenHash === hash && !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now()
    );
    if (idx === -1) {
      throw new AppError(401, 'انتهت صلاحية الجلسة أو تم إلغاؤها', 'INVALID_SESSION');
    }
    const db = readJsonDatabase();
    const user = db.users.find((u) => u.id === sessions[idx].userId);
    if (!user || !user.isActive) {
      throw new AppError(403, 'الحساب غير نشط', 'ACCOUNT_SUSPENDED');
    }
    sessions[idx].refreshTokenHash = newRefreshHash;
    sessions[idx].expiresAt = newExpires;
    writeJsonSessions(sessions);
    const profiles = resolveLinkedProfilesJson(db, user);
    return { sessionId: sessions[idx].id, user, ...profiles };
  });

  const accessToken = signJwt(
    {
      sub: sesFound.user.id,
      role: sesFound.user.role,
      sid: sesFound.sessionId,
      cid: sesFound.customerProfile?.id || null,
      rid: sesFound.representativeProfile?.id || null,
    },
    ACCESS_TOKEN_TTL_SEC
  );

  return {
    accessToken,
    refreshToken: newRefresh,
    expiresIn: ACCESS_TOKEN_TTL_SEC,
    user: sanitizeUser(sesFound.user),
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

export async function validateActiveSession(sessionId, userId) {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query(
      `SELECT u.*, s.id AS session_id
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
    return {
      user: sanitizeUser(user),
      rawUser: user,
      customerProfile: profiles.customerProfile,
      representativeProfile: profiles.representativeProfile,
      linkWarning: profiles.linkWarning,
    };
  }

  const sessions = readJsonSessions();
  const ses = sessions.find(
    (s) => s.id === sessionId && s.userId === userId && !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now()
  );
  if (!ses) return null;
  const db = readJsonDatabase();
  const user = db.users.find((u) => u.id === userId);
  if (!user || !user.isActive) return null;
  const profiles = resolveLinkedProfilesJson(db, user);
  return {
    user: sanitizeUser(user),
    rawUser: user,
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
      return sanitizeUser(mapPgUserRow(next.rows[0]));
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
    return sanitizeUser(u);
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


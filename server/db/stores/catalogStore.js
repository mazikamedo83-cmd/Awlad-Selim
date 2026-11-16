import { getPool, withTransaction } from '../postgres.js';
import { withJsonTransaction, readJsonDatabase } from '../jsonLedger.js';
import { hashPasswordBcrypt, generateServerId } from '../../utils/crypto.js';
import {
  AppError,
  nowIso,
  todayIso,
  round2,
  sanitizeProductForCustomer,
  sanitizeUser,
} from '../../utils/errors.js';
import {
  isPgMode,
  CUSTOMER_DEFAULT_PERMISSIONS,
  mapPgCustomerRow,
  mapPgProductRow,
  mapPgUserRow,
  isoTimestamp,
} from './mode.js';
import { recordAuditLog } from './authStore.js';

export async function listCustomers() {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM customers ORDER BY created_at DESC');
    return res.rows.map(mapPgCustomerRow);
  }
  const db = readJsonDatabase();
  return [...db.customers].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getCustomerById(customerId) {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM customers WHERE id = $1 LIMIT 1', [customerId]);
    return mapPgCustomerRow(res.rows[0]);
  }
  const db = readJsonDatabase();
  return db.customers.find((c) => c.id === customerId) || null;
}

export async function getCustomerByUserId(userId) {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM customers WHERE user_id = $1 LIMIT 1', [userId]);
    return mapPgCustomerRow(res.rows[0]);
  }
  const db = readJsonDatabase();
  return db.customers.find((c) => c.userId === userId) || null;
}

export async function createCustomer(payload, actor) {
  const name = String(payload.name || '').trim();
  if (!name) throw new AppError(400, 'اسم العميل مطلوب', 'INVALID_CUSTOMER_NAME');

  const id = payload.id || generateServerId('CUS');
  const code = String(payload.code || `C-${Date.now().toString().slice(-5)}`).trim();
  const openingBalance = round2(payload.openingBalance ?? 0);
  const currentBalance = round2(payload.currentBalance ?? openingBalance);
  const now = nowIso();
  const userId = payload.userId || null;

  if (await isPgMode()) {
    const created = await withTransaction(async (client) => {
      if (userId) {
        const dupLink = await client.query('SELECT id FROM customers WHERE user_id = $1 LIMIT 1', [userId]);
        if (dupLink.rows[0]) {
          throw new AppError(409, 'حساب المستخدم المختار مرتبط مسبقًا بعميل آخر', 'USER_ALREADY_LINKED');
        }
      }
      await client.query(
        `INSERT INTO customers (id, code, user_id, name, phone, secondary_phone, shop_name, shop_photo, photo, address, area, geo_coordinates, opening_balance, current_balance, price_history, notes, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          id,
          code,
          userId,
          name,
          payload.phone || '',
          payload.secondaryPhone || null,
          payload.shopName || null,
          payload.shopPhoto || null,
          payload.photo || null,
          payload.address || '',
          payload.area || null,
          payload.geoCoordinates || null,
          openingBalance,
          currentBalance,
          JSON.stringify(payload.priceHistory || {}),
          payload.notes || '',
          payload.status || 'active',
          now,
        ]
      );
      const r = await client.query('SELECT * FROM customers WHERE id = $1', [id]);
      return mapPgCustomerRow(r.rows[0]);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `إضافة عميل جديد (${created.name})`,
      module: 'العملاء',
      recordId: created.id,
    });
    return created;
  }

  const created = await withJsonTransaction(async (db) => {
    if (userId && db.customers.some((c) => c.userId === userId)) {
      throw new AppError(409, 'حساب المستخدم المختار مرتبط مسبقًا بعميل آخر', 'USER_ALREADY_LINKED');
    }
    if (db.customers.some((c) => c.code === code)) {
      throw new AppError(409, 'كود العميل مستخدم مسبقًا', 'DUPLICATE_CODE');
    }
    const item = {
      id,
      code,
      userId: userId || undefined,
      name,
      phone: payload.phone || '',
      secondaryPhone: payload.secondaryPhone || undefined,
      shopName: payload.shopName || undefined,
      shopPhoto: payload.shopPhoto || undefined,
      photo: payload.photo || undefined,
      address: payload.address || '',
      area: payload.area || undefined,
      geoCoordinates: payload.geoCoordinates || undefined,
      openingBalance,
      currentBalance,
      priceHistory: payload.priceHistory || {},
      notes: payload.notes || '',
      status: payload.status || 'active',
      createdAt: now,
    };
    db.customers.unshift(item);
    return item;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `إضافة عميل جديد (${created.name})`,
    module: 'العملاء',
    recordId: created.id,
  });
  return created;
}

export async function updateCustomer(customerId, updates, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const existing = await client.query('SELECT * FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
      if (!existing.rows[0]) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
      const cur = mapPgCustomerRow(existing.rows[0]);

      const nextUserId = updates.userId !== undefined ? (updates.userId || null) : (cur.userId || null);
      if (nextUserId && nextUserId !== cur.userId) {
        const dupLink = await client.query('SELECT id FROM customers WHERE user_id = $1 AND id <> $2 LIMIT 1', [
          nextUserId,
          customerId,
        ]);
        if (dupLink.rows[0]) {
          throw new AppError(409, 'حساب المستخدم المختار مرتبط بعميل آخر', 'USER_ALREADY_LINKED');
        }
      }

      await client.query(
        `UPDATE customers SET
          name = $1, phone = $2, secondary_phone = $3, shop_name = $4, shop_photo = $5, photo = $6,
          address = $7, area = $8, geo_coordinates = $9, notes = $10, status = $11, user_id = $12, updated_at = $13
         WHERE id = $14`,
        [
          updates.name ?? cur.name,
          updates.phone ?? cur.phone,
          updates.secondaryPhone ?? cur.secondaryPhone ?? null,
          updates.shopName ?? cur.shopName ?? null,
          updates.shopPhoto ?? cur.shopPhoto ?? null,
          updates.photo ?? cur.photo ?? null,
          updates.address ?? cur.address,
          updates.area ?? cur.area ?? null,
          updates.geoCoordinates ?? cur.geoCoordinates ?? null,
          updates.notes ?? cur.notes ?? '',
          updates.status ?? cur.status,
          nextUserId,
          now,
          customerId,
        ]
      );
      const r = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
      return mapPgCustomerRow(r.rows[0]);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحديث بيانات العميل (${updated.name})`,
      module: 'العملاء',
      recordId: updated.id,
    });
    return updated;
  }

  const updated = await withJsonTransaction(async (db) => {
    const idx = db.customers.findIndex((c) => c.id === customerId);
    if (idx === -1) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    const cur = db.customers[idx];
    if (updates.userId && updates.userId !== cur.userId && db.customers.some((c) => c.userId === updates.userId && c.id !== customerId)) {
      throw new AppError(409, 'حساب المستخدم المختار مرتبط بعميل آخر', 'USER_ALREADY_LINKED');
    }
    const merged = {
      ...cur,
      ...updates,
      id: cur.id,
      currentBalance: cur.currentBalance, // Prevent direct balance override via profile edit
    };
    db.customers[idx] = merged;
    return merged;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تحديث بيانات العميل (${updated.name})`,
    module: 'العملاء',
    recordId: updated.id,
  });
  return updated;
}

export async function deleteCustomer(customerId, actor) {
  if (await isPgMode()) {
    const deleted = await withTransaction(async (client) => {
      const existing = await client.query('SELECT * FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
      if (!existing.rows[0]) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
      const cur = mapPgCustomerRow(existing.rows[0]);
      if (Math.abs(cur.currentBalance) > 0.001) {
        throw new AppError(409, 'لا يمكن حذف عميل عليه رصيد مالي غير مسوّى', 'CUSTOMER_HAS_BALANCE');
      }
      const invRef = await client.query('SELECT id FROM invoices WHERE customer_id = $1 LIMIT 1', [customerId]);
      const ordRef = await client.query('SELECT id FROM customer_item_orders WHERE customer_id = $1 LIMIT 1', [customerId]);
      if (invRef.rows[0] || ordRef.rows[0]) {
        throw new AppError(409, 'لا يمكن حذف عميل مرتبط بفواتير أو طلبات. يمكنك حظره أو إيقافه بدلاً من الحذف.', 'CUSTOMER_REFERENCED');
      }
      await client.query('DELETE FROM customers WHERE id = $1', [customerId]);
      return cur;
    });
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `حذف عميل (${deleted.name})`,
      module: 'العملاء',
      recordId: customerId,
    });
    return { ok: true };
  }

  const deleted = await withJsonTransaction(async (db) => {
    const cur = db.customers.find((c) => c.id === customerId);
    if (!cur) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    if (Math.abs(Number(cur.currentBalance || 0)) > 0.001) {
      throw new AppError(409, 'لا يمكن حذف عميل عليه رصيد مالي غير مسوّى', 'CUSTOMER_HAS_BALANCE');
    }
    if (db.invoices.some((i) => i.customerId === customerId) || db.customerItemOrders.some((o) => o.customerId === customerId)) {
      throw new AppError(409, 'لا يمكن حذف عميل مرتبط بفواتير أو طلبات. يمكنك إيقافه بدلاً من الحذف.', 'CUSTOMER_REFERENCED');
    }
    db.customers = db.customers.filter((c) => c.id !== customerId);
    return cur;
  });
  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `حذف عميل (${deleted.name})`,
    module: 'العملاء',
    recordId: customerId,
  });
  return { ok: true };
}

export async function linkCustomerToUser({ customerId, existingUserId, createUser }, actor) {
  const now = nowIso();
  if (!existingUserId && !createUser) {
    throw new AppError(400, 'يرجى تحديد حساب موجود أو إدخال بيانات إنشاء حساب جديد للعميل', 'MISSING_LINK_TARGET');
  }

  let newPasswordHash = null;
  if (createUser) {
    const uname = String(createUser.username || '').trim();
    const pass = String(createUser.password || '');
    if (uname.length < 3 || pass.length < 6) {
      throw new AppError(400, 'اسم المستخدم (3+ أحرف) وكلمة المرور (6+ أحرف) مطلوبان', 'INVALID_USER_CREDENTIALS');
    }
    newPasswordHash = await hashPasswordBcrypt(pass);
  }

  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      const custRes = await client.query('SELECT * FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
      if (!custRes.rows[0]) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
      const customer = mapPgCustomerRow(custRes.rows[0]);

      let targetUserId = existingUserId || null;
      let createdUser = null;

      if (createUser) {
        const cleanUsername = String(createUser.username).trim();
        const dupUser = await client.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [cleanUsername]);
        if (dupUser.rows[0]) throw new AppError(409, 'اسم المستخدم مسجل مسبقًا', 'DUPLICATE_USERNAME');

        targetUserId = generateServerId('USR');
        await client.query(
          `INSERT INTO users (id, full_name, username, password_hash, password_algo, phone, role, job_title, department, is_active, must_change_password, permissions, created_at)
           VALUES ($1, $2, $3, $4, 'bcrypt', $5, 'customer', 'عميل', 'المبيعات', TRUE, $6, $7, $8)`,
          [
            targetUserId,
            createUser.fullName || customer.name,
            cleanUsername,
            newPasswordHash,
            createUser.phone || customer.phone || '',
            Boolean(createUser.mustChangePassword),
            JSON.stringify(CUSTOMER_DEFAULT_PERMISSIONS),
            now,
          ]
        );
        const uRes = await client.query('SELECT * FROM users WHERE id = $1', [targetUserId]);
        createdUser = sanitizeUser(mapPgUserRow(uRes.rows[0]));
      } else {
        const uRes = await client.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [targetUserId]);
        if (!uRes.rows[0]) throw new AppError(404, 'حساب المستخدم غير موجود', 'USER_NOT_FOUND');
        if (uRes.rows[0].role !== 'customer') {
          throw new AppError(400, 'لا يمكن ربط العميل إلا بحساب يحمل دور عميل (customer)', 'ROLE_MISMATCH');
        }
        const already = await client.query('SELECT id, name FROM customers WHERE user_id = $1 AND id <> $2 LIMIT 1', [
          targetUserId,
          customerId,
        ]);
        if (already.rows[0]) {
          throw new AppError(409, `هذا الحساب مرتبط مسبقًا بالعميل (${already.rows[0].name})`, 'USER_ALREADY_LINKED');
        }
      }

      await client.query('UPDATE customers SET user_id = $1, updated_at = $2 WHERE id = $3', [targetUserId, now, customerId]);
      const updatedCust = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
      return {
        customer: mapPgCustomerRow(updatedCust.rows[0]),
        user: createdUser,
      };
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `ربط العميل (${result.customer.name}) بحساب دخول (${result.customer.userId})`,
      module: 'العملاء',
      recordId: customerId,
    });
    return result;
  }

  const result = await withJsonTransaction(async (db) => {
    const cIdx = db.customers.findIndex((c) => c.id === customerId);
    if (cIdx === -1) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    const customer = db.customers[cIdx];

    let targetUserId = existingUserId || null;
    let createdUser = null;

    if (createUser) {
      const cleanUsername = String(createUser.username).trim();
      if (db.users.some((u) => String(u.username || '').toLowerCase() === cleanUsername.toLowerCase())) {
        throw new AppError(409, 'اسم المستخدم مسجل مسبقًا', 'DUPLICATE_USERNAME');
      }
      targetUserId = generateServerId('USR');
      const newUser = {
        id: targetUserId,
        fullName: createUser.fullName || customer.name,
        username: cleanUsername,
        passwordHash: newPasswordHash,
        passwordAlgo: 'bcrypt',
        phone: createUser.phone || customer.phone || '',
        role: 'customer',
        jobTitle: 'عميل',
        department: 'المبيعات',
        isActive: true,
        mustChangePassword: Boolean(createUser.mustChangePassword),
        permissions: CUSTOMER_DEFAULT_PERMISSIONS,
        createdAt: now,
      };
      db.users.push(newUser);
      createdUser = sanitizeUser(newUser);
    } else {
      const u = db.users.find((x) => x.id === targetUserId);
      if (!u) throw new AppError(404, 'حساب المستخدم غير موجود', 'USER_NOT_FOUND');
      if (u.role !== 'customer') {
        throw new AppError(400, 'لا يمكن ربط العميل إلا بحساب يحمل دور عميل (customer)', 'ROLE_MISMATCH');
      }
      const already = db.customers.find((c) => c.userId === targetUserId && c.id !== customerId);
      if (already) {
        throw new AppError(409, `هذا الحساب مرتبط مسبقًا بالعميل (${already.name})`, 'USER_ALREADY_LINKED');
      }
    }

    db.customers[cIdx] = { ...customer, userId: targetUserId };
    return {
      customer: db.customers[cIdx],
      user: createdUser,
    };
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `ربط العميل (${result.customer.name}) بحساب دخول (${result.customer.userId})`,
    module: 'العملاء',
    recordId: customerId,
  });
  return result;
}

export async function recordCustomerPayment({ customerId, amount, cashboxId, notes = '', date }, actor) {
  const payAmount = round2(amount);
  if (payAmount <= 0) throw new AppError(400, 'مبلغ التحصيل يجب أن يكون أكبر من الصفر', 'INVALID_AMOUNT');
  const txDate = date || todayIso();
  const now = nowIso();
  const txId = generateServerId('FIN');
  const txNumber = `REC-${Date.now().toString().slice(-6)}`;

  if (await isPgMode()) {
    const res = await withTransaction(async (client) => {
      const custRes = await client.query('SELECT * FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
      if (!custRes.rows[0]) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
      const cust = mapPgCustomerRow(custRes.rows[0]);

      const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [cashboxId]);
      if (!cbRes.rows[0]) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');
      const cb = cbRes.rows[0];

      const nextCustBalance = round2(cust.currentBalance - payAmount);
      const nextCbBalance = round2(Number(cb.current_balance || 0) + payAmount);

      await client.query('UPDATE customers SET current_balance = $1, updated_at = $2 WHERE id = $3', [
        nextCustBalance,
        now,
        customerId,
      ]);
      await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextCbBalance, cashboxId]);

      await client.query(
        `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_type, related_entity_id, related_entity_name, related_doc_type, description, notes, created_by, created_at)
         VALUES ($1, $2, $3, 'customer_payment', $4, $5, $6, $7, 'تحصيل من عميل', 'customer', $8, $9, 'manual', $10, $11, $12, $13)`,
        [
          txId,
          txNumber,
          txDate,
          payAmount,
          cb.id,
          cb.name,
          nextCbBalance,
          cust.id,
          cust.name,
          `تحصيل دفعة من العميل: ${cust.name}`,
          notes || '',
          actor.fullName,
          now,
        ]
      );

      const updatedCust = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
      return {
        customer: mapPgCustomerRow(updatedCust.rows[0]),
        cashboxBalance: nextCbBalance,
        transactionId: txId,
        transactionNumber: txNumber,
      };
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحصيل مبلغ ${payAmount} من العميل ${res.customer.name}`,
      module: 'العملاء',
      recordId: customerId,
    });
    return res;
  }

  const res = await withJsonTransaction(async (db) => {
    const cust = db.customers.find((c) => c.id === customerId);
    if (!cust) throw new AppError(404, 'العميل غير موجود', 'CUSTOMER_NOT_FOUND');
    const cb = db.cashboxes.find((c) => c.id === cashboxId);
    if (!cb) throw new AppError(404, 'الخزينة غير موجودة', 'CASHBOX_NOT_FOUND');

    cust.currentBalance = round2(Number(cust.currentBalance || 0) - payAmount);
    cb.currentBalance = round2(Number(cb.currentBalance || 0) + payAmount);

    db.financialTransactions.unshift({
      id: txId,
      transactionNumber: txNumber,
      date: txDate,
      type: 'customer_payment',
      cashboxId: cb.id,
      cashboxName: cb.name,
      amount: payAmount,
      category: 'تحصيل من عميل',
      relatedDocType: 'manual',
      partyId: cust.id,
      partyName: cust.name,
      description: `تحصيل دفعة من العميل: ${cust.name}`,
      notes: notes || '',
      createdBy: actor.fullName,
      createdAt: now,
    });

    return {
      customer: cust,
      cashboxBalance: cb.currentBalance,
      transactionId: txId,
      transactionNumber: txNumber,
    };
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تحصيل مبلغ ${payAmount} من العميل ${res.customer.name}`,
    module: 'العملاء',
    recordId: customerId,
  });
  return res;
}

export async function detectCustomerUserConflicts() {
  const customers = await listCustomers();
  let customerUsers = [];
  if (await isPgMode()) {
    const pool = getPool();
    const uRes = await pool.query(`SELECT * FROM users WHERE role = 'customer'`);
    customerUsers = uRes.rows.map((r) => sanitizeUser(mapPgUserRow(r)));
  } else {
    const db = readJsonDatabase();
    customerUsers = db.users.filter((u) => u.role === 'customer').map(sanitizeUser);
  }

  const linkedUserIds = new Set(customers.filter((c) => c.userId).map((c) => c.userId));
  const unlinkedUsers = customerUsers.filter((u) => !linkedUserIds.has(u.id));
  const unlinkedCustomers = customers.filter((c) => !c.userId);

  const phoneCounts = new Map();
  for (const c of customers) {
    const p = String(c.phone || '').trim();
    if (p) phoneCounts.set(p, (phoneCounts.get(p) || 0) + 1);
  }
  const duplicatePhones = [...phoneCounts.entries()].filter(([, cnt]) => cnt > 1).map(([phone, count]) => ({ phone, count }));

  return { unlinkedUsers, unlinkedCustomers, duplicatePhones };
}

// ==============================================================================
// Products & Categories
// ==============================================================================

export async function listCategories() {
  if (await isPgMode()) {
    const pool = getPool();
    const res = await pool.query('SELECT * FROM product_categories ORDER BY created_at ASC');
    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || '',
      status: r.status || 'active',
      createdAt: isoTimestamp(r.created_at),
    }));
  }
  return readJsonDatabase().categories;
}

export async function createCategory(payload, actor) {
  const name = String(payload.name || '').trim();
  if (!name) throw new AppError(400, 'اسم التصنيف مطلوب', 'INVALID_CATEGORY');
  const id = payload.id || generateServerId('CAT');
  const now = nowIso();

  if (await isPgMode()) {
    const created = await withTransaction(async (client) => {
      const dup = await client.query('SELECT id FROM product_categories WHERE LOWER(name) = LOWER($1) LIMIT 1', [name]);
      if (dup.rows[0]) throw new AppError(409, 'اسم التصنيف مسجل مسبقًا', 'DUPLICATE_CATEGORY');
      await client.query(
        `INSERT INTO product_categories (id, name, description, status, created_at) VALUES ($1, $2, $3, $4, $5)`,
        [id, name, payload.description || '', payload.status || 'active', now]
      );
      return { id, name, description: payload.description || '', status: payload.status || 'active', createdAt: now };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة تصنيف (${name})`, module: 'التصنيفات', recordId: id });
    return created;
  }

  const created = await withJsonTransaction(async (db) => {
    if (db.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      throw new AppError(409, 'اسم التصنيف مسجل مسبقًا', 'DUPLICATE_CATEGORY');
    }
    const cat = { id, name, description: payload.description || '', status: payload.status || 'active', createdAt: now };
    db.categories.push(cat);
    return cat;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة تصنيف (${name})`, module: 'التصنيفات', recordId: id });
  return created;
}

export async function updateCategory(categoryId, updates, actor) {
  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const curRes = await client.query('SELECT * FROM product_categories WHERE id = $1 FOR UPDATE', [categoryId]);
      if (!curRes.rows[0]) throw new AppError(404, 'التصنيف غير موجود', 'CATEGORY_NOT_FOUND');
      const cur = curRes.rows[0];
      const nextName = String(updates.name ?? cur.name).trim();
      await client.query('UPDATE product_categories SET name = $1, description = $2, status = $3 WHERE id = $4', [
        nextName,
        updates.description ?? cur.description ?? '',
        updates.status ?? cur.status,
        categoryId,
      ]);
      if (nextName !== cur.name) {
        await client.query('UPDATE products SET category = $1 WHERE category = $2 OR category_id = $3', [nextName, cur.name, categoryId]);
      }
      return { id: categoryId, name: nextName, description: updates.description ?? cur.description ?? '', status: updates.status ?? cur.status, createdAt: isoTimestamp(cur.created_at) };
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث تصنيف (${updated.name})`, module: 'التصنيفات', recordId: categoryId });
    return updated;
  }

  const updated = await withJsonTransaction(async (db) => {
    const idx = db.categories.findIndex((c) => c.id === categoryId);
    if (idx === -1) throw new AppError(404, 'التصنيف غير موجود', 'CATEGORY_NOT_FOUND');
    const oldName = db.categories[idx].name;
    db.categories[idx] = { ...db.categories[idx], ...updates };
    if (updates.name && updates.name !== oldName) {
      db.products = db.products.map((p) => (p.category === oldName || p.categoryId === categoryId ? { ...p, category: updates.name } : p));
    }
    return db.categories[idx];
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث تصنيف (${updated.name})`, module: 'التصنيفات', recordId: categoryId });
  return updated;
}

export async function deleteCategory(categoryId, actor) {
  if (await isPgMode()) {
    await withTransaction(async (client) => {
      const curRes = await client.query('SELECT * FROM product_categories WHERE id = $1 FOR UPDATE', [categoryId]);
      if (!curRes.rows[0]) throw new AppError(404, 'التصنيف غير موجود', 'CATEGORY_NOT_FOUND');
      const used = await client.query('SELECT id FROM products WHERE category = $1 OR category_id = $2 LIMIT 1', [curRes.rows[0].name, categoryId]);
      if (used.rows[0]) throw new AppError(409, 'لا يمكن حذف تصنيف مرتبط بمنتجات حالية', 'CATEGORY_IN_USE');
      await client.query('DELETE FROM product_categories WHERE id = $1', [categoryId]);
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف تصنيف`, module: 'التصنيفات', recordId: categoryId });
    return { ok: true };
  }

  await withJsonTransaction(async (db) => {
    const cat = db.categories.find((c) => c.id === categoryId);
    if (!cat) throw new AppError(404, 'التصنيف غير موجود', 'CATEGORY_NOT_FOUND');
    if (db.products.some((p) => p.category === cat.name || p.categoryId === categoryId)) {
      throw new AppError(409, 'لا يمكن حذف تصنيف مرتبط بمنتجات حالية', 'CATEGORY_IN_USE');
    }
    db.categories = db.categories.filter((c) => c.id !== categoryId);
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف تصنيف`, module: 'التصنيفات', recordId: categoryId });
  return { ok: true };
}

export async function listProducts({ forCustomer = false } = {}) {
  let products = [];
  if (await isPgMode()) {
    const pool = getPool();
    const pRes = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    const uRes = await pool.query('SELECT * FROM product_units');
    const unitsByProd = new Map();
    for (const u of uRes.rows) {
      const list = unitsByProd.get(u.product_id) || [];
      list.push(u);
      unitsByProd.set(u.product_id, list);
    }
    products = pRes.rows.map((p) => mapPgProductRow(p, unitsByProd.get(p.id) || []));
  } else {
    products = [...readJsonDatabase().products].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  if (forCustomer) {
    return products.filter((p) => p.status === 'active').map(sanitizeProductForCustomer);
  }
  return products;
}

export async function createProduct(payload, actor) {
  const name = String(payload.name || '').trim();
  const code = String(payload.code || `P-${Date.now().toString().slice(-6)}`).trim();
  if (!name) throw new AppError(400, 'اسم الصنف مطلوب', 'INVALID_PRODUCT_NAME');

  const id = payload.id || generateServerId('PRD');
  const now = nowIso();
  const units = Array.isArray(payload.units)
    ? payload.units.map((u, idx) => ({
        id: u.id || `${id}-U-${idx + 1}`,
        name: u.name,
        conversionFactor: Number(u.conversionFactor || 1),
        barcode: u.barcode || '',
        purchasePrice: Number(u.purchasePrice ?? 0),
        sellingPrice: Number(u.sellingPrice ?? 0),
      }))
    : [];

  if (await isPgMode()) {
    const created = await withTransaction(async (client) => {
      const dup = await client.query('SELECT id FROM products WHERE code = $1 LIMIT 1', [code]);
      if (dup.rows[0]) throw new AppError(409, 'كود الصنف مستخدم مسبقًا', 'DUPLICATE_PRODUCT_CODE');

      await client.query(
        `INSERT INTO products (id, code, barcode, name, category, category_id, base_unit, size, color, purchase_price, selling_price, min_stock_level, stock_per_warehouse, image, notes, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
        [
          id,
          code,
          payload.barcode || '',
          name,
          payload.category || 'عام',
          payload.categoryId || null,
          payload.baseUnit || 'قطعة',
          payload.size || null,
          payload.color || null,
          round2(payload.purchasePrice || 0),
          round2(payload.sellingPrice || 0),
          round2(payload.minStockLevel || 0),
          JSON.stringify(payload.stockPerWarehouse || {}),
          payload.image || null,
          payload.notes || '',
          payload.status || 'active',
          now,
        ]
      );
      for (const u of units) {
        await client.query(
          `INSERT INTO product_units (id, product_id, name, conversion_factor, barcode, purchase_price, selling_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [u.id, id, u.name, u.conversionFactor, u.barcode, u.purchasePrice, u.sellingPrice]
        );
      }

      // Opening stock movements if initial stockPerWarehouse > 0
      const stockMap = payload.stockPerWarehouse || {};
      for (const [whId, qty] of Object.entries(stockMap)) {
        const numQty = Number(qty || 0);
        if (numQty > 0) {
          const whRes = await client.query('SELECT name FROM warehouses WHERE id = $1 LIMIT 1', [whId]);
          if (whRes.rows[0]) {
            await client.query(
              `INSERT INTO stock_movements (id, movement_number, date, product_id, product_name, warehouse_id, warehouse_name, movement_type, quantity, unit, unit_factor, unit_cost, balance_after, related_doc_type, notes, created_by, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'opening', $8, $9, 1, $10, $8, 'opening', 'رصيد افتتاحي', $11, $12)`,
              [
                generateServerId('STK'),
                `OPEN-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 100)}`,
                todayIso(),
                id,
                name,
                whId,
                whRes.rows[0].name,
                numQty,
                payload.baseUnit || 'قطعة',
                round2(payload.purchasePrice || 0),
                actor.fullName,
                now,
              ]
            );
          }
        }
      }

      const pRes = await client.query('SELECT * FROM products WHERE id = $1', [id]);
      const uRes = await client.query('SELECT * FROM product_units WHERE product_id = $1', [id]);
      return mapPgProductRow(pRes.rows[0], uRes.rows);
    });

    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة صنف (${name})`, module: 'المخزون', recordId: id });
    return created;
  }

  const created = await withJsonTransaction(async (db) => {
    if (db.products.some((p) => p.code === code)) {
      throw new AppError(409, 'كود الصنف مستخدم مسبقًا', 'DUPLICATE_PRODUCT_CODE');
    }
    const prod = {
      id,
      code,
      barcode: payload.barcode || '',
      name,
      category: payload.category || 'عام',
      categoryId: payload.categoryId || undefined,
      baseUnit: payload.baseUnit || 'قطعة',
      units,
      size: payload.size || undefined,
      color: payload.color || undefined,
      purchasePrice: round2(payload.purchasePrice || 0),
      sellingPrice: round2(payload.sellingPrice || 0),
      minStockLevel: round2(payload.minStockLevel || 0),
      stockPerWarehouse: payload.stockPerWarehouse || {},
      image: payload.image || undefined,
      notes: payload.notes || '',
      status: payload.status || 'active',
      createdAt: now,
    };
    db.products.unshift(prod);
    for (const [whId, qty] of Object.entries(prod.stockPerWarehouse)) {
      const n = Number(qty || 0);
      if (n > 0) {
        const wh = db.warehouses.find((w) => w.id === whId);
        if (wh) {
          db.stockMovements.unshift({
            id: generateServerId('STK'),
            date: todayIso(),
            type: 'opening',
            productId: prod.id,
            productName: prod.name,
            warehouseId: wh.id,
            warehouseName: wh.name,
            quantity: n,
            unitCost: prod.purchasePrice,
            notes: 'رصيد افتتاحي',
            createdBy: actor.fullName,
            createdAt: now,
          });
        }
      }
    }
    return prod;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `إضافة صنف (${name})`, module: 'المخزون', recordId: id });
  return created;
}

export async function updateProduct(productId, updates, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
      if (!pRes.rows[0]) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
      const uRes = await client.query('SELECT * FROM product_units WHERE product_id = $1', [productId]);
      const cur = mapPgProductRow(pRes.rows[0], uRes.rows);

      await client.query(
        `UPDATE products SET
          code = $1, barcode = $2, name = $3, category = $4, category_id = $5, base_unit = $6,
          size = $7, color = $8, purchase_price = $9, selling_price = $10, min_stock_level = $11,
          image = $12, notes = $13, status = $14, updated_at = $15
         WHERE id = $16`,
        [
          updates.code ?? cur.code,
          updates.barcode ?? cur.barcode,
          updates.name ?? cur.name,
          updates.category ?? cur.category,
          updates.categoryId ?? cur.categoryId ?? null,
          updates.baseUnit ?? cur.baseUnit,
          updates.size ?? cur.size ?? null,
          updates.color ?? cur.color ?? null,
          round2(updates.purchasePrice ?? cur.purchasePrice),
          round2(updates.sellingPrice ?? cur.sellingPrice),
          round2(updates.minStockLevel ?? cur.minStockLevel),
          updates.image ?? cur.image ?? null,
          updates.notes ?? cur.notes ?? '',
          updates.status ?? cur.status,
          now,
          productId,
        ]
      );

      if (Array.isArray(updates.units)) {
        await client.query('DELETE FROM product_units WHERE product_id = $1', [productId]);
        for (let idx = 0; idx < updates.units.length; idx++) {
          const u = updates.units[idx];
          await client.query(
            `INSERT INTO product_units (id, product_id, name, conversion_factor, barcode, purchase_price, selling_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              u.id || `${productId}-U-${idx + 1}`,
              productId,
              u.name,
              Number(u.conversionFactor || 1),
              u.barcode || '',
              Number(u.purchasePrice ?? 0),
              Number(u.sellingPrice ?? 0),
            ]
          );
        }
      }

      const nextP = await client.query('SELECT * FROM products WHERE id = $1', [productId]);
      const nextU = await client.query('SELECT * FROM product_units WHERE product_id = $1', [productId]);
      return mapPgProductRow(nextP.rows[0], nextU.rows);
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث بيانات صنف (${updated.name})`, module: 'المخزون', recordId: productId });
    return updated;
  }

  const updated = await withJsonTransaction(async (db) => {
    const idx = db.products.findIndex((p) => p.id === productId);
    if (idx === -1) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
    const cur = db.products[idx];
    db.products[idx] = {
      ...cur,
      ...updates,
      id: cur.id,
      stockPerWarehouse: cur.stockPerWarehouse, // Protect stock map from direct override via product edit
    };
    return db.products[idx];
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `تحديث بيانات صنف (${updated.name})`, module: 'المخزون', recordId: productId });
  return updated;
}

export async function deleteProduct(productId, actor) {
  if (await isPgMode()) {
    const name = await withTransaction(async (client) => {
      const pRes = await client.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [productId]);
      if (!pRes.rows[0]) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
      const invUsed = await client.query('SELECT id FROM invoice_items WHERE product_id = $1 LIMIT 1', [productId]);
      const ordUsed = await client.query('SELECT id FROM customer_item_order_items WHERE product_id = $1 LIMIT 1', [productId]);
      if (invUsed.rows[0] || ordUsed.rows[0]) {
        throw new AppError(409, 'لا يمكن حذف صنف مرتبط بفواتير أو طلبات. يمكنك أرشفته بدلاً من الحذف.', 'PRODUCT_REFERENCED');
      }
      await client.query('DELETE FROM stock_movements WHERE product_id = $1', [productId]);
      await client.query('DELETE FROM products WHERE id = $1', [productId]);
      return pRes.rows[0].name;
    });
    await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف صنف (${name})`, module: 'المخزون', recordId: productId });
    return { ok: true };
  }

  const name = await withJsonTransaction(async (db) => {
    const prod = db.products.find((p) => p.id === productId);
    if (!prod) throw new AppError(404, 'الصنف غير موجود', 'PRODUCT_NOT_FOUND');
    const invUsed = db.invoices.some((inv) => Array.isArray(inv.items) && inv.items.some((it) => it.productId === productId));
    const ordUsed = db.customerItemOrders.some((o) => Array.isArray(o.items) && o.items.some((it) => it.productId === productId));
    if (invUsed || ordUsed) {
      throw new AppError(409, 'لا يمكن حذف صنف مرتبط بفواتير أو طلبات. يمكنك أرشفته بدلاً من الحذف.', 'PRODUCT_REFERENCED');
    }
    db.products = db.products.filter((p) => p.id !== productId);
    return prod.name;
  });
  await recordAuditLog({ userId: actor.id, userName: actor.fullName, action: `حذف صنف (${name})`, module: 'المخزون', recordId: productId });
  return { ok: true };
}

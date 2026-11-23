import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, withTransaction, isStrictPostgresMode } from './postgres.js';
import { readJsonDatabase, withJsonTransaction } from './jsonLedger.js';
import { generateServerId } from '../utils/crypto.js';
import { AppError, normalizePhoneDigits, nowIso } from '../utils/errors.js';
import {
  isPgMode,
  isoTimestamp,
} from './stores/mode.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.AWLAD_DATA_DIR
  ? path.resolve(process.env.AWLAD_DATA_DIR)
  : path.join(__dirname, '..', 'data');

export const ENTITY_TYPE_TO_TABLE = {
  user: 'users',
  employee: 'employees',
  representative: 'representatives',
  customer: 'customers',
  supplier: 'suppliers',
};

export const ALLOWED_ENTITY_TYPES = new Set(['user', 'employee', 'representative', 'customer', 'supplier']);

export function normalizeIdentityName(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\s+/g, ' ');
}

export function normalizeNationalId(nid) {
  return String(nid || '')
    .trim()
    .replace(/[\s-]+/g, '')
    .toUpperCase();
}

function mapPgIdentityRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    identityType: r.identity_type || 'person',
    fullName: r.full_name,
    primaryPhone: r.primary_phone || '',
    normalizedPhone: r.normalized_phone || '',
    secondaryPhone: r.secondary_phone || '',
    nationalId: r.national_id || '',
    commercialReg: r.commercial_reg || '',
    address: r.address || '',
    status: r.status || 'active',
    notes: r.notes || '',
    createdAt: isoTimestamp(r.created_at),
    updatedAt: isoTimestamp(r.updated_at || r.created_at),
  };
}

function mapPgIdentityRoleRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    identityId: r.identity_id,
    roleKey: r.role_key,
    linkedRecordType: r.linked_record_type,
    linkedRecordId: r.linked_record_id,
    isPrimary: Boolean(r.is_primary),
    status: r.status || 'active',
    createdAt: isoTimestamp(r.created_at),
    updatedAt: isoTimestamp(r.updated_at || r.created_at),
  };
}

function mapPgConflictRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    conflictType: r.conflict_type,
    severity: r.severity || 'warning',
    identifierKey: r.identifier_key || '',
    candidateRecords: Array.isArray(r.candidate_records) ? r.candidate_records : [],
    status: r.status || 'pending_review',
    resolutionNotes: r.resolution_notes || '',
    resolvedBy: r.resolved_by || undefined,
    resolvedAt: r.resolved_at ? isoTimestamp(r.resolved_at) : undefined,
    createdAt: isoTimestamp(r.created_at),
  };
}

export async function logIdentityConflictPgTx(client, { conflictType, severity = 'warning', identifierKey = '', candidateRecords = [] }) {
  const existing = await client.query(
    `SELECT id FROM identity_conflicts WHERE conflict_type = $1 AND identifier_key = $2 AND status = 'pending_review' LIMIT 1`,
    [conflictType, identifierKey]
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE identity_conflicts SET candidate_records = $1, severity = $2 WHERE id = $3`,
      [JSON.stringify(candidateRecords), severity, existing.rows[0].id]
    );
    return existing.rows[0].id;
  }
  const id = generateServerId('IDCF');
  await client.query(
    `INSERT INTO identity_conflicts (id, conflict_type, severity, identifier_key, candidate_records, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'pending_review', $6)`,
    [id, conflictType, severity, identifierKey, JSON.stringify(candidateRecords), nowIso()]
  );
  return id;
}

export function logIdentityConflictJsonTx(db, { conflictType, severity = 'warning', identifierKey = '', candidateRecords = [] }) {
  if (!Array.isArray(db.identityConflicts)) db.identityConflicts = [];
  const existing = db.identityConflicts.find(
    (c) => c.conflictType === conflictType && c.identifierKey === identifierKey && c.status === 'pending_review'
  );
  if (existing) {
    existing.candidateRecords = candidateRecords;
    existing.severity = severity;
    return existing.id;
  }
  const id = generateServerId('IDCF');
  db.identityConflicts.unshift({
    id,
    conflictType,
    severity,
    identifierKey,
    candidateRecords,
    status: 'pending_review',
    resolutionNotes: '',
    createdAt: nowIso(),
  });
  return id;
}

export async function assertNoSameRoleDuplicatesPgTx(client, { entityType, excludeEntityId = null, phone = '', nationalId = '', allowPhoneOverlap = false }) {
  const normPhone = normalizePhoneDigits(phone);
  const normNid = normalizeNationalId(nationalId);

  if (entityType === 'employee') {
    if (normNid) {
      const nidRes = await client.query(
        `SELECT id, full_name, code, national_id FROM employees WHERE national_id IS NOT NULL AND national_id <> ''`
      );
      const dupNid = (nidRes.rows || []).filter(
        (r) => r.id !== excludeEntityId && normalizeNationalId(r.national_id) === normNid
      );
      if (dupNid.length > 0) {
        await logIdentityConflictPgTx(client, {
          conflictType: 'duplicate_national_id_blocked',
          severity: 'high',
          identifierKey: `employee:nid:${normNid}`,
          candidateRecords: dupNid.map((d) => ({ entityType: 'employee', id: d.id, name: d.full_name, code: d.code, nationalId: d.national_id })),
        });
        throw new AppError(
          409,
          `الرقم القومي (${nationalId}) مسجل مسبقًا للموظف (${dupNid[0].full_name} - ${dupNid[0].code}). لا يمكن تكرار ملف الموظف؛ يمكنك تعديل أو ربط السجل القائم.`,
          'DUPLICATE_EMPLOYEE_NATIONAL_ID'
        );
      }
    }
    if (normPhone && !allowPhoneOverlap) {
      const phRes = await client.query(
        `SELECT id, full_name, code, phone FROM employees WHERE normalized_phone = $1 LIMIT 2`,
        [normPhone]
      );
      const dupPh = (phRes.rows || []).filter((r) => r.id !== excludeEntityId);
      if (dupPh.length > 0) {
        throw new AppError(
          409,
          `رقم الهاتف (${phone}) مسجل مسبقًا للموظف (${dupPh[0].full_name} - ${dupPh[0].code}). يرجى ربط الحساب بالموظف القائم بدلاً من إنشاء سجل مكرر.`,
          'DUPLICATE_EMPLOYEE_PHONE'
        );
      }
    }
  }

  if (entityType === 'supplier' && normPhone && !allowPhoneOverlap) {
    const supRes = await client.query(
      `SELECT id, name, code, phone FROM suppliers WHERE normalized_phone = $1 LIMIT 2`,
      [normPhone]
    );
    const dupSup = (supRes.rows || []).filter((r) => r.id !== excludeEntityId);
    if (dupSup.length > 0) {
      throw new AppError(
        409,
        `رقم الهاتف (${phone}) مسجل مسبقًا للمورد (${dupSup[0].name} - ${dupSup[0].code}).`,
        'DUPLICATE_SUPPLIER_PHONE'
      );
    }
  }

  if (entityType === 'customer' && normPhone && !allowPhoneOverlap) {
    const custRes = await client.query(
      `SELECT id, name, code, phone FROM customers WHERE normalized_phone = $1 LIMIT 2`,
      [normPhone]
    );
    const dupCust = (custRes.rows || []).filter((r) => r.id !== excludeEntityId);
    if (dupCust.length > 0) {
      throw new AppError(
        409,
        `رقم الهاتف (${phone}) مسجل مسبقًا للعميل (${dupCust[0].name} - ${dupCust[0].code}).`,
        'DUPLICATE_CUSTOMER_PHONE'
      );
    }
  }

  if (entityType === 'representative' && normPhone && !allowPhoneOverlap) {
    const repRes = await client.query(
      `SELECT id, name, code, phone FROM representatives WHERE normalized_phone = $1 LIMIT 2`,
      [normPhone]
    );
    const dupRep = (repRes.rows || []).filter((r) => r.id !== excludeEntityId);
    if (dupRep.length > 0) {
      throw new AppError(
        409,
        `رقم الهاتف (${phone}) مسجل مسبقًا للمندوب (${dupRep[0].name}).`,
        'DUPLICATE_REP_PHONE'
      );
    }
  }
}

export function assertNoSameRoleDuplicatesJsonTx(db, { entityType, excludeEntityId = null, phone = '', nationalId = '', allowPhoneOverlap = false }) {
  const normPhone = normalizePhoneDigits(phone);
  const normNid = normalizeNationalId(nationalId);

  if (entityType === 'employee') {
    if (normNid) {
      const dupNid = (db.employees || []).find(
        (e) => e.id !== excludeEntityId && e.nationalId && normalizeNationalId(e.nationalId) === normNid
      );
      if (dupNid) {
        logIdentityConflictJsonTx(db, {
          conflictType: 'duplicate_national_id_blocked',
          severity: 'high',
          identifierKey: `employee:nid:${normNid}`,
          candidateRecords: [{ entityType: 'employee', id: dupNid.id, name: dupNid.name, code: dupNid.code, nationalId: dupNid.nationalId }],
        });
        throw new AppError(
          409,
          `الرقم القومي (${nationalId}) مسجل مسبقًا للموظف (${dupNid.name} - ${dupNid.code}). لا يمكن تكرار ملف الموظف؛ يمكنك تعديل أو ربط السجل القائم.`,
          'DUPLICATE_EMPLOYEE_NATIONAL_ID'
        );
      }
    }
    if (normPhone && !allowPhoneOverlap) {
      const dupPh = (db.employees || []).find(
        (e) => e.id !== excludeEntityId && e.phone && normalizePhoneDigits(e.phone) === normPhone
      );
      if (dupPh) {
        throw new AppError(
          409,
          `رقم الهاتف (${phone}) مسجل مسبقًا للموظف (${dupPh.name} - ${dupPh.code}). يرجى ربط الحساب بالموظف القائم بدلاً من إنشاء سجل مكرر.`,
          'DUPLICATE_EMPLOYEE_PHONE'
        );
      }
    }
  }

  if (entityType === 'supplier' && normPhone && !allowPhoneOverlap) {
    const dupSup = (db.suppliers || []).find(
      (s) => s.id !== excludeEntityId && s.phone && normalizePhoneDigits(s.phone) === normPhone
    );
    if (dupSup) {
      throw new AppError(
        409,
        `رقم الهاتف (${phone}) مسجل مسبقًا للمورد (${dupSup.name} - ${dupSup.code}).`,
        'DUPLICATE_SUPPLIER_PHONE'
      );
    }
  }

  if (entityType === 'customer' && normPhone && !allowPhoneOverlap) {
    const dupCust = (db.customers || []).find(
      (c) => c.id !== excludeEntityId && c.phone && normalizePhoneDigits(c.phone) === normPhone
    );
    if (dupCust) {
      throw new AppError(
        409,
        `رقم الهاتف (${phone}) مسجل مسبقًا للعميل (${dupCust.name} - ${dupCust.code}).`,
        'DUPLICATE_CUSTOMER_PHONE'
      );
    }
  }

  if (entityType === 'representative' && normPhone && !allowPhoneOverlap) {
    const dupRep = (db.representatives || []).find(
      (r) => r.id !== excludeEntityId && r.phone && normalizePhoneDigits(r.phone) === normPhone
    );
    if (dupRep) {
      throw new AppError(
        409,
        `رقم الهاتف (${phone}) مسجل مسبقًا للمندوب (${dupRep.name}).`,
        'DUPLICATE_REP_PHONE'
      );
    }
  }
}

/**
 * Ensures a record (user / employee / representative / customer / supplier) is linked cleanly to ONE unified Identity & identity_roles entry.
 * NEVER auto-merges based on name alone.
 */
export async function attachRecordToIdentityPgTx(
  client,
  {
    entityType,
    entityId,
    roleKey = null,
    fullName = '',
    phone = '',
    secondaryPhone = '',
    nationalId = '',
    commercialReg = '',
    address = '',
    notes = '',
    identityType = 'person',
    explicitIdentityId = null,
    linkedUserId = null,
    linkedEmployeeId = null,
    matchByNationalId = true,
    matchByUniquePhone = false,
    isPrimary = false,
    now = nowIso(),
  }
) {
  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    throw new AppError(400, 'نوع السجل المرتبط بالهوية غير صالح', 'INVALID_ENTITY_TYPE');
  }
  const effectiveRoleKey = roleKey || entityType;
  const tableName = ENTITY_TYPE_TO_TABLE[entityType];
  const normPhone = normalizePhoneDigits(phone);
  const normNid = normalizeNationalId(nationalId);

  let targetIdentityId = explicitIdentityId || null;

  // 1. Existing link directly on the entity itself or identity_roles
  if (!targetIdentityId) {
    const existingRole = await client.query(
      `SELECT identity_id FROM identity_roles WHERE linked_record_type = $1 AND linked_record_id = $2 LIMIT 1`,
      [entityType, entityId]
    );
    if (existingRole.rows[0]?.identity_id) {
      targetIdentityId = existingRole.rows[0].identity_id;
    } else {
      const entityRow = await client.query(`SELECT identity_id FROM ${tableName} WHERE id = $1 LIMIT 1`, [entityId]);
      if (entityRow.rows[0]?.identity_id) {
        targetIdentityId = entityRow.rows[0].identity_id;
      }
    }
  }

  // 2. Explicit employee link
  if (!targetIdentityId && linkedEmployeeId) {
    const empRes = await client.query(`SELECT id, identity_id, full_name, phone, national_id, notes FROM employees WHERE id = $1 LIMIT 1`, [linkedEmployeeId]);
    const emp = empRes.rows[0];
    if (!emp) throw new AppError(404, 'سجل الموظف المحدد للربط غير موجود', 'EMPLOYEE_NOT_FOUND');
    if (emp.identity_id) {
      targetIdentityId = emp.identity_id;
    } else {
      const mintedId = generateServerId('IDN');
      const empNormPh = normalizePhoneDigits(emp.phone);
      await client.query(
        `INSERT INTO identities (id, identity_type, full_name, primary_phone, normalized_phone, national_id, status, notes, created_at, updated_at)
         VALUES ($1, 'person', $2, $3, $4, $5, 'active', $6, $7, $7)`,
        [mintedId, emp.full_name, emp.phone || '', empNormPh, emp.national_id || '', emp.notes || '', now]
      );
      await client.query(`UPDATE employees SET identity_id = $1, normalized_phone = $2 WHERE id = $3`, [mintedId, empNormPh, emp.id]);
      await client.query(
        `INSERT INTO identity_roles (id, identity_id, role_key, linked_record_type, linked_record_id, is_primary, status, created_at, updated_at)
         VALUES ($1, $2, 'employee', 'employee', $3, TRUE, 'active', $4, $4)
         ON CONFLICT (linked_record_type, linked_record_id) DO NOTHING`,
        [generateServerId('IDR'), mintedId, emp.id, now]
      );
      targetIdentityId = mintedId;
    }
  }

  // 3. Linked userId
  if (!targetIdentityId && linkedUserId) {
    const uRes = await client.query(`SELECT id, identity_id, full_name, phone FROM users WHERE id = $1 LIMIT 1`, [linkedUserId]);
    const usr = uRes.rows[0];
    if (usr?.identity_id) {
      targetIdentityId = usr.identity_id;
    } else if (usr) {
      const mintedId = generateServerId('IDN');
      const usrNormPh = normalizePhoneDigits(usr.phone);
      await client.query(
        `INSERT INTO identities (id, identity_type, full_name, primary_phone, normalized_phone, status, created_at, updated_at)
         VALUES ($1, 'person', $2, $3, $4, 'active', $5, $5)`,
        [mintedId, usr.full_name, usr.phone || '', usrNormPh, now]
      );
      await client.query(`UPDATE users SET identity_id = $1 WHERE id = $2`, [mintedId, usr.id]);
      await client.query(
        `INSERT INTO identity_roles (id, identity_id, role_key, linked_record_type, linked_record_id, is_primary, status, created_at, updated_at)
         VALUES ($1, $2, 'user', 'user', $3, TRUE, 'active', $4, $4)
         ON CONFLICT (linked_record_type, linked_record_id) DO NOTHING`,
        [generateServerId('IDR'), mintedId, usr.id, now]
      );
      targetIdentityId = mintedId;
    }
  }

  // 4. Deterministic National ID match (indexed)
  if (!targetIdentityId && matchByNationalId && normNid) {
    const nidMatches = await client.query(
      `SELECT id, national_id FROM identities WHERE national_id IS NOT NULL AND national_id <> ''`
    );
    const matchedNidRows = (nidMatches.rows || []).filter((r) => normalizeNationalId(r.national_id) === normNid);
    if (matchedNidRows.length === 1) {
      targetIdentityId = matchedNidRows[0].id;
    }
  }

  // 5. Optional deterministic unique phone match across existing identities (ONLY when no ambiguity)
  if (!targetIdentityId && matchByUniquePhone && normPhone) {
    const phMatches = await client.query(
      `SELECT id, full_name FROM identities WHERE normalized_phone = $1 LIMIT 3`,
      [normPhone]
    );
    if (phMatches.rows.length === 1) {
      // Ensure this identity does not already hold the exact same role type with a different ID
      const existingSameRole = await client.query(
        `SELECT linked_record_id FROM identity_roles WHERE identity_id = $1 AND linked_record_type = $2 LIMIT 1`,
        [phMatches.rows[0].id, entityType]
      );
      if (!existingSameRole.rows[0] || existingSameRole.rows[0].linked_record_id === entityId) {
        targetIdentityId = phMatches.rows[0].id;
      }
    }
  }

  // 6. Verify identity doesn't already own a different record for the same role_key/type
  if (targetIdentityId) {
    const checkIdn = await client.query(`SELECT id, primary_phone, normalized_phone, national_id, address FROM identities WHERE id = $1 LIMIT 1`, [targetIdentityId]);
    if (!checkIdn.rows[0]) {
      throw new AppError(404, 'الهوية الموحدة المحددة غير موجودة', 'IDENTITY_NOT_FOUND');
    }
    const dupRole = await client.query(
      `SELECT linked_record_type, linked_record_id FROM identity_roles WHERE identity_id = $1 AND role_key = $2 LIMIT 1`,
      [targetIdentityId, effectiveRoleKey]
    );
    if (dupRole.rows[0] && (dupRole.rows[0].linked_record_id !== entityId || dupRole.rows[0].linked_record_type !== entityType)) {
      throw new AppError(
        409,
        `الهوية الموحدة مربوطة مسبقًا بسجل آخر لنفس الدور (${effectiveRoleKey}). يرجى استخدام السجل القائم أو فك الارتباط أولاً.`,
        'DUPLICATE_IDENTITY_ROLE'
      );
    }
    // Enrich missing contact details on identity non-destructively
    const curIdn = checkIdn.rows[0];
    const nextPh = curIdn.primary_phone || phone || '';
    const nextNormPh = curIdn.normalized_phone || normPhone || '';
    const nextNid = curIdn.national_id || nationalId || '';
    const nextAddr = curIdn.address || address || '';
    await client.query(
      `UPDATE identities SET primary_phone = $1, normalized_phone = $2, national_id = $3, address = $4, updated_at = $5 WHERE id = $6`,
      [nextPh, nextNormPh, nextNid, nextAddr, now, targetIdentityId]
    );
  } else {
    targetIdentityId = generateServerId('IDN');
    await client.query(
      `INSERT INTO identities (id, identity_type, full_name, primary_phone, normalized_phone, secondary_phone, national_id, commercial_reg, address, status, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11, $11)`,
      [
        targetIdentityId,
        identityType === 'organization' ? 'organization' : 'person',
        fullName || entityId,
        phone || '',
        normPhone,
        secondaryPhone || '',
        nationalId || '',
        commercialReg || '',
        address || '',
        notes || '',
        now,
      ]
    );
  }

  // Stamp identity_id on target entity row
  await client.query(`UPDATE ${tableName} SET identity_id = $1 WHERE id = $2`, [targetIdentityId, entityId]);

  // Ensure identity_roles link (remove stale link for this record if rebinding)
  await client.query(
    `DELETE FROM identity_roles WHERE linked_record_type = $1 AND linked_record_id = $2 AND identity_id <> $3`,
    [entityType, entityId, targetIdentityId]
  );
  const existingPair = await client.query(
    `SELECT id FROM identity_roles WHERE linked_record_type = $1 AND linked_record_id = $2 LIMIT 1`,
    [entityType, entityId]
  );
  if (existingPair.rows[0]) {
    await client.query(
      `UPDATE identity_roles SET identity_id = $1, role_key = $2, updated_at = $3 WHERE id = $4`,
      [targetIdentityId, effectiveRoleKey, now, existingPair.rows[0].id]
    );
  } else {
    await client.query(
      `INSERT INTO identity_roles (id, identity_id, role_key, linked_record_type, linked_record_id, is_primary, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $7)`,
      [generateServerId('IDR'), targetIdentityId, effectiveRoleKey, entityType, entityId, Boolean(isPrimary), now]
    );
  }

  return targetIdentityId;
}

export function attachRecordToIdentityJsonTx(
  db,
  {
    entityType,
    entityId,
    roleKey = null,
    fullName = '',
    phone = '',
    secondaryPhone = '',
    nationalId = '',
    commercialReg = '',
    address = '',
    notes = '',
    identityType = 'person',
    explicitIdentityId = null,
    linkedUserId = null,
    linkedEmployeeId = null,
    matchByNationalId = true,
    matchByUniquePhone = false,
    isPrimary = false,
    now = nowIso(),
  }
) {
  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    throw new AppError(400, 'نوع السجل المرتبط بالهوية غير صالح', 'INVALID_ENTITY_TYPE');
  }
  if (!Array.isArray(db.identities)) db.identities = [];
  if (!Array.isArray(db.identityRoles)) db.identityRoles = [];
  if (!Array.isArray(db.identityConflicts)) db.identityConflicts = [];

  const effectiveRoleKey = roleKey || entityType;
  const listKey =
    entityType === 'user'
      ? 'users'
      : entityType === 'employee'
      ? 'employees'
      : entityType === 'representative'
      ? 'representatives'
      : entityType === 'customer'
      ? 'customers'
      : 'suppliers';

  const entityObj = (db[listKey] || []).find((x) => x.id === entityId);
  const normPhone = normalizePhoneDigits(phone);
  const normNid = normalizeNationalId(nationalId);

  let targetIdentityId = explicitIdentityId || null;
  if (!targetIdentityId) {
    const existingRole = db.identityRoles.find(
      (ir) => ir.linkedRecordType === entityType && ir.linkedRecordId === entityId
    );
    targetIdentityId = existingRole?.identityId || entityObj?.identityId || null;
  }

  if (!targetIdentityId && linkedEmployeeId) {
    const emp = (db.employees || []).find((e) => e.id === linkedEmployeeId);
    if (!emp) throw new AppError(404, 'سجل الموظف المحدد للربط غير موجود', 'EMPLOYEE_NOT_FOUND');
    if (emp.identityId) {
      targetIdentityId = emp.identityId;
    } else {
      const mintedId = generateServerId('IDN');
      const empNormPh = normalizePhoneDigits(emp.phone);
      db.identities.push({
        id: mintedId,
        identityType: 'person',
        fullName: emp.name,
        primaryPhone: emp.phone || '',
        normalizedPhone: empNormPh,
        secondaryPhone: '',
        nationalId: emp.nationalId || '',
        commercialReg: '',
        address: '',
        status: 'active',
        notes: emp.notes || '',
        createdAt: now,
        updatedAt: now,
      });
      emp.identityId = mintedId;
      db.identityRoles.push({
        id: generateServerId('IDR'),
        identityId: mintedId,
        roleKey: 'employee',
        linkedRecordType: 'employee',
        linkedRecordId: emp.id,
        isPrimary: true,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      targetIdentityId = mintedId;
    }
  }

  if (!targetIdentityId && linkedUserId) {
    const usr = (db.users || []).find((u) => u.id === linkedUserId);
    if (usr?.identityId) {
      targetIdentityId = usr.identityId;
    } else if (usr) {
      const mintedId = generateServerId('IDN');
      db.identities.push({
        id: mintedId,
        identityType: 'person',
        fullName: usr.fullName || usr.username,
        primaryPhone: usr.phone || '',
        normalizedPhone: normalizePhoneDigits(usr.phone),
        secondaryPhone: '',
        nationalId: '',
        commercialReg: '',
        address: usr.address || '',
        status: 'active',
        notes: '',
        createdAt: now,
        updatedAt: now,
      });
      usr.identityId = mintedId;
      db.identityRoles.push({
        id: generateServerId('IDR'),
        identityId: mintedId,
        roleKey: 'user',
        linkedRecordType: 'user',
        linkedRecordId: usr.id,
        isPrimary: true,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
      targetIdentityId = mintedId;
    }
  }

  if (!targetIdentityId && matchByNationalId && normNid) {
    const nidMatches = db.identities.filter((idn) => idn.nationalId && normalizeNationalId(idn.nationalId) === normNid);
    if (nidMatches.length === 1) {
      targetIdentityId = nidMatches[0].id;
    }
  }

  if (!targetIdentityId && matchByUniquePhone && normPhone) {
    const phMatches = db.identities.filter((idn) => idn.normalizedPhone === normPhone);
    if (phMatches.length === 1) {
      const sameRole = db.identityRoles.find(
        (ir) => ir.identityId === phMatches[0].id && ir.linkedRecordType === entityType
      );
      if (!sameRole || sameRole.linkedRecordId === entityId) {
        targetIdentityId = phMatches[0].id;
      }
    }
  }

  if (targetIdentityId) {
    const idn = db.identities.find((x) => x.id === targetIdentityId);
    if (!idn) throw new AppError(404, 'الهوية الموحدة المحددة غير موجودة', 'IDENTITY_NOT_FOUND');
    const dupRole = db.identityRoles.find(
      (ir) => ir.identityId === targetIdentityId && ir.roleKey === effectiveRoleKey
    );
    if (dupRole && (dupRole.linkedRecordId !== entityId || dupRole.linkedRecordType !== entityType)) {
      throw new AppError(
        409,
        `الهوية الموحدة مربوطة مسبقًا بسجل آخر لنفس الدور (${effectiveRoleKey}). يرجى استخدام السجل القائم أو فك الارتباط أولاً.`,
        'DUPLICATE_IDENTITY_ROLE'
      );
    }
    if (!idn.primaryPhone && phone) {
      idn.primaryPhone = phone;
      idn.normalizedPhone = normPhone;
    }
    if (!idn.nationalId && nationalId) idn.nationalId = nationalId;
    if (!idn.address && address) idn.address = address;
    idn.updatedAt = now;
  } else {
    targetIdentityId = generateServerId('IDN');
    db.identities.push({
      id: targetIdentityId,
      identityType: identityType === 'organization' ? 'organization' : 'person',
      fullName: fullName || entityId,
      primaryPhone: phone || '',
      normalizedPhone: normPhone,
      secondaryPhone: secondaryPhone || '',
      nationalId: nationalId || '',
      commercialReg: commercialReg || '',
      address: address || '',
      status: 'active',
      notes: notes || '',
      createdAt: now,
      updatedAt: now,
    });
  }

  if (entityObj) {
    entityObj.identityId = targetIdentityId;
  }

  db.identityRoles = db.identityRoles.filter(
    (ir) => !(ir.linkedRecordType === entityType && ir.linkedRecordId === entityId && ir.identityId !== targetIdentityId)
  );
  const existingPair = db.identityRoles.find(
    (ir) => ir.linkedRecordType === entityType && ir.linkedRecordId === entityId
  );
  if (existingPair) {
    existingPair.identityId = targetIdentityId;
    existingPair.roleKey = effectiveRoleKey;
    existingPair.updatedAt = now;
  } else {
    db.identityRoles.push({
      id: generateServerId('IDR'),
      identityId: targetIdentityId,
      roleKey: effectiveRoleKey,
      linkedRecordType: entityType,
      linkedRecordId: entityId,
      isPrimary: Boolean(isPrimary),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
  }

  return targetIdentityId;
}

export async function resolveActorIdentityPgTx(client, actor) {
  if (!actor || !actor.id) {
    return { actorIdentityId: null, actorEmployeeId: null, actingRole: null };
  }
  let actorIdentityId = actor.identityId || null;
  let actorEmployeeId = actor.employeeId || null;
  const actingRole = actor.activeRole || actor.role || null;

  if (!actorIdentityId || !actorEmployeeId) {
    const uRes = await client.query(`SELECT identity_id, employee_id FROM users WHERE id = $1 LIMIT 1`, [actor.id]);
    if (uRes.rows[0]) {
      actorIdentityId = actorIdentityId || uRes.rows[0].identity_id || null;
      actorEmployeeId = actorEmployeeId || uRes.rows[0].employee_id || null;
    }
    if (!actorEmployeeId && actorIdentityId) {
      const empRole = await client.query(
        `SELECT linked_record_id FROM identity_roles WHERE identity_id = $1 AND linked_record_type = 'employee' LIMIT 1`,
        [actorIdentityId]
      );
      if (empRole.rows[0]?.linked_record_id) {
        actorEmployeeId = empRole.rows[0].linked_record_id;
      }
    }
  }

  return { actorIdentityId, actorEmployeeId, actingRole };
}

export function resolveActorIdentityJsonTx(db, actor) {
  if (!actor || !actor.id) {
    return { actorIdentityId: null, actorEmployeeId: null, actingRole: null };
  }
  const usr = (db.users || []).find((u) => u.id === actor.id);
  let actorIdentityId = actor.identityId || usr?.identityId || null;
  let actorEmployeeId = actor.employeeId || usr?.employeeId || null;
  if (!actorEmployeeId && actorIdentityId) {
    const empRole = (db.identityRoles || []).find(
      (ir) => ir.identityId === actorIdentityId && ir.linkedRecordType === 'employee'
    );
    if (empRole) actorEmployeeId = empRole.linkedRecordId;
  }
  if (!actorEmployeeId) {
    const empByUser = (db.employees || []).find((e) => e.userId === actor.id);
    if (empByUser) actorEmployeeId = empByUser.id;
  }
  return {
    actorIdentityId: actorIdentityId || undefined,
    actorEmployeeId: actorEmployeeId || undefined,
    actingRole: actor.activeRole || actor.role || undefined,
  };
}

export async function resolveIdentityContextForUserPg(client, user) {
  if (!user || !user.id) return { identityId: null, employeeId: null, linkedRoles: [] };
  let identityId = user.identityId || null;
  let employeeId = user.employeeId || null;

  if (!identityId) {
    const roleRow = await client.query(
      `SELECT identity_id FROM identity_roles WHERE linked_record_type = 'user' AND linked_record_id = $1 LIMIT 1`,
      [user.id]
    );
    if (roleRow.rows[0]?.identity_id) identityId = roleRow.rows[0].identity_id;
  }

  let linkedRoles = [];
  if (identityId) {
    const rolesRes = await client.query(
      `SELECT role_key, linked_record_type, linked_record_id, status FROM identity_roles WHERE identity_id = $1 ORDER BY created_at ASC`,
      [identityId]
    );
    linkedRoles = (rolesRes.rows || []).map((r) => ({
      roleKey: r.role_key,
      recordType: r.linked_record_type,
      recordId: r.linked_record_id,
      status: r.status || 'active',
    }));
    if (!employeeId) {
      const empEntry = linkedRoles.find((r) => r.recordType === 'employee');
      if (empEntry) employeeId = empEntry.recordId;
    }
  }
  if (!employeeId) {
    const empDirect = await client.query(`SELECT id FROM employees WHERE user_id = $1 LIMIT 1`, [user.id]);
    if (empDirect.rows[0]?.id) employeeId = empDirect.rows[0].id;
  }

  return { identityId: identityId || undefined, employeeId: employeeId || undefined, linkedRoles };
}

export function resolveIdentityContextForUserJson(db, user) {
  if (!user || !user.id) return { identityId: undefined, employeeId: undefined, linkedRoles: [] };
  let identityId = user.identityId || null;
  let employeeId = user.employeeId || null;

  if (!identityId) {
    const roleRow = (db.identityRoles || []).find(
      (ir) => ir.linkedRecordType === 'user' && ir.linkedRecordId === user.id
    );
    if (roleRow?.identityId) identityId = roleRow.identityId;
  }

  let linkedRoles = [];
  if (identityId) {
    linkedRoles = (db.identityRoles || [])
      .filter((ir) => ir.identityId === identityId)
      .map((ir) => ({
        roleKey: ir.roleKey,
        recordType: ir.linkedRecordType,
        recordId: ir.linkedRecordId,
        status: ir.status || 'active',
      }));
    if (!employeeId) {
      const empEntry = linkedRoles.find((r) => r.recordType === 'employee');
      if (empEntry) employeeId = empEntry.recordId;
    }
  }
  if (!employeeId) {
    const empDirect = (db.employees || []).find((e) => e.userId === user.id);
    if (empDirect) employeeId = empDirect.id;
  }

  return { identityId: identityId || undefined, employeeId: employeeId || undefined, linkedRoles };
}

/**
 * Shared graph/backfill engine for both JSON state & PG state.
 * Never deletes balances or merges ambiguous name-only duplicates.
 */
function runSafeIdentityAuditCore({
  users,
  employees,
  customers,
  representatives,
  suppliers,
  existingIdentities,
  existingRoles,
  existingConflicts,
}) {
  const now = nowIso();
  const identities = existingIdentities.map((x) => ({ ...x }));
  const identityById = new Map(identities.map((i) => [i.id, i]));
  const identityRoles = existingRoles.map((r) => ({ ...r }));
  const roleByRecordKey = new Map(identityRoles.map((r) => [`${r.linkedRecordType}:${r.linkedRecordId}`, r]));
  const conflicts = existingConflicts.map((c) => ({ ...c }));

  const recordUpdates = {
    users: new Map(), // id -> { identityId, employeeId }
    employees: new Map(), // id -> { identityId, userId, normalizedPhone }
    customers: new Map(), // id -> { identityId }
    representatives: new Map(), // id -> { identityId }
    suppliers: new Map(), // id -> { identityId, userId, normalizedPhone }
  };

  let createdIdentitiesCount = 0;
  let linkedRolesCount = 0;
  let newConflictsCount = 0;

  const ensureConflict = (conflictType, severity, identifierKey, candidateRecords) => {
    const existing = conflicts.find(
      (c) => c.conflictType === conflictType && c.identifierKey === identifierKey && c.status === 'pending_review'
    );
    if (existing) {
      existing.candidateRecords = candidateRecords;
      existing.severity = severity;
      return;
    }
    conflicts.unshift({
      id: generateServerId('IDCF'),
      conflictType,
      severity,
      identifierKey,
      candidateRecords,
      status: 'pending_review',
      resolutionNotes: '',
      createdAt: now,
    });
    newConflictsCount += 1;
  };

  const getEntityRecordIdentity = (entityType, entity) => {
    const roleEntry = roleByRecordKey.get(`${entityType}:${entity.id}`);
    return roleEntry?.identityId || entity.identityId || null;
  };

  const assignIdentity = (entityType, entity, targetIdentityId, { fullName, phone, nationalId = '', address = '', identityType = 'person', isPrimary = false }) => {
    const roleKey = entityType;
    let idnId = targetIdentityId || getEntityRecordIdentity(entityType, entity);
    const normPh = normalizePhoneDigits(phone);

    if (!idnId || !identityById.has(idnId)) {
      idnId = generateServerId('IDN');
      const newIdn = {
        id: idnId,
        identityType,
        fullName: fullName || entity.name || entity.fullName || entity.id,
        primaryPhone: phone || '',
        normalizedPhone: normPh,
        secondaryPhone: '',
        nationalId: nationalId || '',
        commercialReg: '',
        address: address || '',
        status: 'active',
        notes: '',
        createdAt: now,
        updatedAt: now,
      };
      identities.push(newIdn);
      identityById.set(idnId, newIdn);
      createdIdentitiesCount += 1;
    } else {
      const idn = identityById.get(idnId);
      if (!idn.primaryPhone && phone) {
        idn.primaryPhone = phone;
        idn.normalizedPhone = normPh;
      }
      if (!idn.nationalId && nationalId) idn.nationalId = nationalId;
      if (!idn.address && address) idn.address = address;
    }

    const rKey = `${entityType}:${entity.id}`;
    const existingRole = roleByRecordKey.get(rKey);
    const roleConflictOnIdn = identityRoles.find(
      (r) => r.identityId === idnId && r.roleKey === roleKey && !(r.linkedRecordType === entityType && r.linkedRecordId === entity.id)
    );
    if (roleConflictOnIdn) {
      // Do NOT overwrite an existing distinct record for the same role; create standalone identity & flag conflict
      const isolatedId = generateServerId('IDN');
      const isoIdn = {
        id: isolatedId,
        identityType,
        fullName: fullName || entity.name || entity.fullName || entity.id,
        primaryPhone: phone || '',
        normalizedPhone: normPh,
        secondaryPhone: '',
        nationalId: nationalId || '',
        commercialReg: '',
        address: address || '',
        status: 'active',
        notes: '',
        createdAt: now,
        updatedAt: now,
      };
      identities.push(isoIdn);
      identityById.set(isolatedId, isoIdn);
      createdIdentitiesCount += 1;
      idnId = isolatedId;
      ensureConflict('same_role_identity_collision', 'high', `${roleKey}:${entity.id}`, [
        { entityType, id: entity.id, name: fullName, phone },
        { entityType: roleConflictOnIdn.linkedRecordType, id: roleConflictOnIdn.linkedRecordId, note: 'هوية مرتبطة مسبقًا' },
      ]);
    }

    if (!existingRole) {
      const newRole = {
        id: generateServerId('IDR'),
        identityId: idnId,
        roleKey,
        linkedRecordType: entityType,
        linkedRecordId: entity.id,
        isPrimary: Boolean(isPrimary),
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      identityRoles.push(newRole);
      roleByRecordKey.set(rKey, newRole);
      linkedRolesCount += 1;
    } else if (existingRole.identityId !== idnId) {
      existingRole.identityId = idnId;
      existingRole.updatedAt = now;
    }

    return idnId;
  };

  // Build explicit link lookup maps (already linked by foreign keys)
  const empById = new Map(employees.map((e) => [e.id, e]));
  const userById = new Map(users.map((u) => [u.id, u]));

  // Detect within-role phone / nationalId conflicts BEFORE linking so ambiguous phones NEVER auto-merge
  const phoneGroupsByRole = {
    employee: new Map(),
    customer: new Map(),
    representative: new Map(),
    supplier: new Map(),
    user: new Map(),
  };
  const empNidGroups = new Map();

  for (const e of employees) {
    const ph = normalizePhoneDigits(e.phone);
    if (ph) {
      const arr = phoneGroupsByRole.employee.get(ph) || [];
      arr.push(e);
      phoneGroupsByRole.employee.set(ph, arr);
    }
    const nid = normalizeNationalId(e.nationalId);
    if (nid) {
      const arr = empNidGroups.get(nid) || [];
      arr.push(e);
      empNidGroups.set(nid, arr);
    }
  }
  for (const c of customers) {
    const ph = normalizePhoneDigits(c.phone);
    if (ph) {
      const arr = phoneGroupsByRole.customer.get(ph) || [];
      arr.push(c);
      phoneGroupsByRole.customer.set(ph, arr);
    }
  }
  for (const r of representatives) {
    const ph = normalizePhoneDigits(r.phone);
    if (ph) {
      const arr = phoneGroupsByRole.representative.get(ph) || [];
      arr.push(r);
      phoneGroupsByRole.representative.set(ph, arr);
    }
  }
  for (const s of suppliers) {
    const ph = normalizePhoneDigits(s.phone);
    if (ph) {
      const arr = phoneGroupsByRole.supplier.get(ph) || [];
      arr.push(s);
      phoneGroupsByRole.supplier.set(ph, arr);
    }
  }
  for (const u of users) {
    const ph = normalizePhoneDigits(u.phone);
    if (ph) {
      const arr = phoneGroupsByRole.user.get(ph) || [];
      arr.push(u);
      phoneGroupsByRole.user.set(ph, arr);
    }
  }

  for (const [nid, list] of empNidGroups.entries()) {
    if (list.length > 1) {
      ensureConflict(
        'duplicate_national_id',
        'high',
        `nid:${nid}`,
        list.map((e) => ({ entityType: 'employee', id: e.id, code: e.code, name: e.name, phone: e.phone, nationalId: e.nationalId }))
      );
    }
  }

  for (const [roleType, phMap] of Object.entries(phoneGroupsByRole)) {
    for (const [ph, list] of phMap.entries()) {
      if (list.length > 1) {
        ensureConflict(
          'same_phone_same_role',
          'warning',
          `${roleType}:phone:${ph}`,
          list.map((item) => ({ entityType: roleType, id: item.id, name: item.name || item.fullName, code: item.code || item.username || '', phone: item.phone }))
        );
      }
    }
  }

  // Track unique phone -> identity map ONLY for unambiguous cross-role phone linking
  const uniquePhoneToIdentity = new Map();
  const ambiguousPhones = new Set();
  for (const phMap of Object.values(phoneGroupsByRole)) {
    for (const [ph, list] of phMap.entries()) {
      if (list.length > 1) ambiguousPhones.add(ph);
    }
  }
  for (const idn of identities) {
    if (idn.normalizedPhone && !ambiguousPhones.has(idn.normalizedPhone)) {
      if (uniquePhoneToIdentity.has(idn.normalizedPhone)) {
        ambiguousPhones.add(idn.normalizedPhone);
        uniquePhoneToIdentity.delete(idn.normalizedPhone);
      } else {
        uniquePhoneToIdentity.set(idn.normalizedPhone, idn.id);
      }
    }
  }

  // Step 1: Process Users first (preserving existing employee_id, rep, customer links)
  for (const u of users) {
    let targetIdn = getEntityRecordIdentity('user', u);
    let linkedEmpId = u.employeeId || null;
    if (!linkedEmpId) {
      const empByUsr = employees.find((e) => e.userId === u.id);
      if (empByUsr) linkedEmpId = empByUsr.id;
    }
    if (!targetIdn && linkedEmpId && empById.has(linkedEmpId)) {
      const emp = empById.get(linkedEmpId);
      targetIdn = getEntityRecordIdentity('employee', emp);
    }
    // Check explicit linked rep or customer
    if (!targetIdn) {
      const repLinked = representatives.find((r) => r.userId === u.id);
      if (repLinked) targetIdn = getEntityRecordIdentity('representative', repLinked);
    }
    if (!targetIdn) {
      const custLinked = customers.find((c) => c.userId === u.id);
      if (custLinked) targetIdn = getEntityRecordIdentity('customer', custLinked);
    }
    const ph = normalizePhoneDigits(u.phone);
    if (!targetIdn && ph && !ambiguousPhones.has(ph) && uniquePhoneToIdentity.has(ph)) {
      targetIdn = uniquePhoneToIdentity.get(ph);
    }

    const assignedIdn = assignIdentity('user', u, targetIdn, {
      fullName: u.fullName || u.username,
      phone: u.phone || '',
      address: u.address || '',
      isPrimary: true,
    });
    if (ph && !ambiguousPhones.has(ph)) {
      uniquePhoneToIdentity.set(ph, assignedIdn);
    }
    recordUpdates.users.set(u.id, {
      identityId: assignedIdn,
      employeeId: linkedEmpId || undefined,
    });
  }

  // Step 2: Process Employees
  for (const e of employees) {
    let targetIdn = getEntityRecordIdentity('employee', e);
    let linkedUserId = e.userId || null;
    if (!linkedUserId) {
      const uMatch = users.find((u) => u.employeeId === e.id);
      if (uMatch) linkedUserId = uMatch.id;
    }
    if (!targetIdn && linkedUserId && userById.has(linkedUserId)) {
      targetIdn = recordUpdates.users.get(linkedUserId)?.identityId || getEntityRecordIdentity('user', userById.get(linkedUserId));
    }
    const ph = normalizePhoneDigits(e.phone);
    if (!targetIdn && ph && !ambiguousPhones.has(ph) && uniquePhoneToIdentity.has(ph)) {
      targetIdn = uniquePhoneToIdentity.get(ph);
    }
    const assignedIdn = assignIdentity('employee', e, targetIdn, {
      fullName: e.name,
      phone: e.phone || '',
      nationalId: e.nationalId || '',
      isPrimary: true,
    });
    if (ph && !ambiguousPhones.has(ph)) {
      uniquePhoneToIdentity.set(ph, assignedIdn);
    }
    recordUpdates.employees.set(e.id, {
      identityId: assignedIdn,
      userId: linkedUserId || undefined,
      normalizedPhone: ph,
    });
    if (linkedUserId) {
      const curU = recordUpdates.users.get(linkedUserId) || {};
      if (!curU.employeeId) {
        recordUpdates.users.set(linkedUserId, { ...curU, identityId: assignedIdn, employeeId: e.id });
      }
    }
  }

  // Step 3: Process Representatives
  for (const r of representatives) {
    let targetIdn = getEntityRecordIdentity('representative', r);
    if (!targetIdn && r.userId) {
      targetIdn = recordUpdates.users.get(r.userId)?.identityId || (userById.get(r.userId) ? getEntityRecordIdentity('user', userById.get(r.userId)) : null);
    }
    const ph = normalizePhoneDigits(r.phone);
    if (!targetIdn && ph && !ambiguousPhones.has(ph) && uniquePhoneToIdentity.has(ph)) {
      targetIdn = uniquePhoneToIdentity.get(ph);
    }
    const assignedIdn = assignIdentity('representative', r, targetIdn, {
      fullName: r.name,
      phone: r.phone || '',
    });
    if (ph && !ambiguousPhones.has(ph)) {
      uniquePhoneToIdentity.set(ph, assignedIdn);
    }
    recordUpdates.representatives.set(r.id, { identityId: assignedIdn });
  }

  // Step 4: Process Customers
  for (const c of customers) {
    let targetIdn = getEntityRecordIdentity('customer', c);
    if (!targetIdn && c.userId) {
      targetIdn = recordUpdates.users.get(c.userId)?.identityId || (userById.get(c.userId) ? getEntityRecordIdentity('user', userById.get(c.userId)) : null);
    }
    const ph = normalizePhoneDigits(c.phone);
    if (!targetIdn && ph && !ambiguousPhones.has(ph) && uniquePhoneToIdentity.has(ph)) {
      targetIdn = uniquePhoneToIdentity.get(ph);
    }
    const assignedIdn = assignIdentity('customer', c, targetIdn, {
      fullName: c.name,
      phone: c.phone || '',
      address: c.address || '',
    });
    if (ph && !ambiguousPhones.has(ph)) {
      uniquePhoneToIdentity.set(ph, assignedIdn);
    }
    recordUpdates.customers.set(c.id, { identityId: assignedIdn });
  }

  // Step 5: Process Suppliers
  for (const s of suppliers) {
    let targetIdn = getEntityRecordIdentity('supplier', s);
    if (!targetIdn && s.userId) {
      targetIdn = recordUpdates.users.get(s.userId)?.identityId || (userById.get(s.userId) ? getEntityRecordIdentity('user', userById.get(s.userId)) : null);
    }
    const ph = normalizePhoneDigits(s.phone);
    if (!targetIdn && ph && !ambiguousPhones.has(ph) && uniquePhoneToIdentity.has(ph)) {
      targetIdn = uniquePhoneToIdentity.get(ph);
    }
    const assignedIdn = assignIdentity('supplier', s, targetIdn, {
      fullName: s.name,
      phone: s.phone || '',
      address: s.address || '',
      identityType: s.companyName ? 'organization' : 'person',
    });
    if (ph && !ambiguousPhones.has(ph)) {
      uniquePhoneToIdentity.set(ph, assignedIdn);
    }
    recordUpdates.suppliers.set(s.id, {
      identityId: assignedIdn,
      userId: s.userId || undefined,
      normalizedPhone: ph,
    });
  }

  // Step 6: Flag name-similarity candidates across separate identities that were NOT auto-merged
  const nameBuckets = new Map();
  for (const e of employees) {
    const nk = normalizeIdentityName(e.name);
    if (!nk) continue;
    const arr = nameBuckets.get(nk) || [];
    arr.push({ entityType: 'employee', id: e.id, name: e.name, phone: e.phone || '', identityId: recordUpdates.employees.get(e.id)?.identityId });
    nameBuckets.set(nk, arr);
  }
  for (const u of users) {
    const nk = normalizeIdentityName(u.fullName);
    if (!nk) continue;
    const arr = nameBuckets.get(nk) || [];
    arr.push({ entityType: 'user', id: u.id, name: u.fullName, username: u.username, phone: u.phone || '', identityId: recordUpdates.users.get(u.id)?.identityId });
    nameBuckets.set(nk, arr);
  }
  for (const r of representatives) {
    const nk = normalizeIdentityName(r.name);
    if (!nk) continue;
    const arr = nameBuckets.get(nk) || [];
    arr.push({ entityType: 'representative', id: r.id, name: r.name, phone: r.phone || '', identityId: recordUpdates.representatives.get(r.id)?.identityId });
    nameBuckets.set(nk, arr);
  }

  for (const [nk, items] of nameBuckets.entries()) {
    const distinctIdentities = new Set(items.map((x) => x.identityId).filter(Boolean));
    if (distinctIdentities.size > 1) {
      ensureConflict('name_similarity_needs_review', 'warning', `name:${nk}`, items);
    }
  }

  return {
    identities,
    identityRoles,
    conflicts,
    recordUpdates,
    stats: {
      totalIdentities: identities.length,
      totalRoles: identityRoles.length,
      createdIdentitiesCount,
      linkedRolesCount,
      pendingConflictsCount: conflicts.filter((c) => c.status === 'pending_review').length,
      newConflictsCount,
    },
  };
}

export async function runSafeIdentityAuditAndBackfill({ targetPool = null, executedBy = 'النظام', createBackup = true } = {}) {
  const usePg = Boolean(targetPool) || (await isPgMode());

  if (usePg) {
    const pool = targetPool || getPool();
    return withTransaction(async (client) => {
      const [uRes, eRes, cRes, rRes, sRes, idnRes, roleRes, cfRes] = await Promise.all([
        client.query(`SELECT id, full_name, username, phone, address, role, identity_id, employee_id, created_at FROM users`),
        client.query(`SELECT id, code, full_name, phone, national_id, notes, identity_id, user_id, created_at FROM employees`),
        client.query(`SELECT id, code, user_id, name, phone, address, identity_id, created_at FROM customers`),
        client.query(`SELECT id, code, user_id, name, phone, identity_id, created_at FROM representatives`),
        client.query(`SELECT id, code, name, phone, address, identity_id, user_id, created_at FROM suppliers`),
        client.query(`SELECT * FROM identities`),
        client.query(`SELECT * FROM identity_roles`),
        client.query(`SELECT * FROM identity_conflicts`),
      ]);

      const users = (uRes.rows || []).map((u) => ({
        id: u.id,
        fullName: u.full_name,
        username: u.username,
        phone: u.phone || '',
        address: u.address || '',
        role: u.role,
        identityId: u.identity_id || undefined,
        employeeId: u.employee_id || undefined,
      }));
      const employees = (eRes.rows || []).map((e) => ({
        id: e.id,
        code: e.code,
        name: e.full_name,
        phone: e.phone || '',
        nationalId: e.national_id || '',
        notes: e.notes || '',
        identityId: e.identity_id || undefined,
        userId: e.user_id || undefined,
      }));
      const customers = (cRes.rows || []).map((c) => ({
        id: c.id,
        code: c.code,
        userId: c.user_id || undefined,
        name: c.name,
        phone: c.phone || '',
        address: c.address || '',
        identityId: c.identity_id || undefined,
      }));
      const representatives = (rRes.rows || []).map((r) => ({
        id: r.id,
        code: r.code,
        userId: r.user_id || undefined,
        name: r.name,
        phone: r.phone || '',
        identityId: r.identity_id || undefined,
      }));
      const suppliers = (sRes.rows || []).map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        phone: s.phone || '',
        address: s.address || '',
        identityId: s.identity_id || undefined,
        userId: s.user_id || undefined,
      }));

      const auditResult = runSafeIdentityAuditCore({
        users,
        employees,
        customers,
        representatives,
        suppliers,
        existingIdentities: (idnRes.rows || []).map(mapPgIdentityRow),
        existingRoles: (roleRes.rows || []).map(mapPgIdentityRoleRow),
        existingConflicts: (cfRes.rows || []).map(mapPgConflictRow),
      });

      for (const idn of auditResult.identities) {
        await client.query(
          `INSERT INTO identities (id, identity_type, full_name, primary_phone, normalized_phone, secondary_phone, national_id, commercial_reg, address, status, notes, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (id) DO UPDATE SET
             primary_phone = EXCLUDED.primary_phone,
             normalized_phone = EXCLUDED.normalized_phone,
             national_id = EXCLUDED.national_id,
             address = EXCLUDED.address,
             updated_at = EXCLUDED.updated_at`,
          [
            idn.id,
            idn.identityType || 'person',
            idn.fullName,
            idn.primaryPhone || '',
            idn.normalizedPhone || '',
            idn.secondaryPhone || '',
            idn.nationalId || '',
            idn.commercialReg || '',
            idn.address || '',
            idn.status || 'active',
            idn.notes || '',
            idn.createdAt || nowIso(),
            idn.updatedAt || nowIso(),
          ]
        );
      }

      for (const role of auditResult.identityRoles) {
        await client.query(
          `INSERT INTO identity_roles (id, identity_id, role_key, linked_record_type, linked_record_id, is_primary, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (linked_record_type, linked_record_id) DO UPDATE SET
             identity_id = EXCLUDED.identity_id,
             role_key = EXCLUDED.role_key,
             updated_at = EXCLUDED.updated_at`,
          [
            role.id,
            role.identityId,
            role.roleKey,
            role.linkedRecordType,
            role.linkedRecordId,
            Boolean(role.isPrimary),
            role.status || 'active',
            role.createdAt || nowIso(),
            role.updatedAt || nowIso(),
          ]
        );
      }

      for (const cf of auditResult.conflicts) {
        await client.query(
          `INSERT INTO identity_conflicts (id, conflict_type, severity, identifier_key, candidate_records, status, resolution_notes, resolved_by, resolved_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO UPDATE SET
             candidate_records = EXCLUDED.candidate_records,
             severity = EXCLUDED.severity`,
          [
            cf.id,
            cf.conflictType,
            cf.severity || 'warning',
            cf.identifierKey || '',
            JSON.stringify(cf.candidateRecords || []),
            cf.status || 'pending_review',
            cf.resolutionNotes || '',
            cf.resolvedBy || null,
            cf.resolvedAt || null,
            cf.createdAt || nowIso(),
          ]
        );
      }

      for (const [id, upd] of auditResult.recordUpdates.users.entries()) {
        await client.query(`UPDATE users SET identity_id = $1, employee_id = COALESCE(employee_id, $2) WHERE id = $3`, [
          upd.identityId,
          upd.employeeId || null,
          id,
        ]);
      }
      for (const [id, upd] of auditResult.recordUpdates.employees.entries()) {
        await client.query(`UPDATE employees SET identity_id = $1, user_id = COALESCE(user_id, $2), normalized_phone = $3 WHERE id = $4`, [
          upd.identityId,
          upd.userId || null,
          upd.normalizedPhone || '',
          id,
        ]);
      }
      for (const [id, upd] of auditResult.recordUpdates.customers.entries()) {
        await client.query(`UPDATE customers SET identity_id = $1 WHERE id = $2`, [upd.identityId, id]);
      }
      for (const [id, upd] of auditResult.recordUpdates.representatives.entries()) {
        await client.query(`UPDATE representatives SET identity_id = $1 WHERE id = $2`, [upd.identityId, id]);
      }
      for (const [id, upd] of auditResult.recordUpdates.suppliers.entries()) {
        await client.query(`UPDATE suppliers SET identity_id = $1, user_id = COALESCE(user_id, $2), normalized_phone = $3 WHERE id = $4`, [
          upd.identityId,
          upd.userId || null,
          upd.normalizedPhone || '',
          id,
        ]);
      }

      return { ok: true, mode: 'postgres', executedBy, ...auditResult.stats };
    }, pool);
  }

  // JSON mode (with immutable pre-backfill snapshot if requested)
  let backupFile = null;
  if (createBackup) {
    try {
      const dbFile = path.join(dataDir, 'database.json');
      if (fs.existsSync(dbFile)) {
        fs.mkdirSync(dataDir, { recursive: true });
        backupFile = path.join(dataDir, `database.pre_identity_audit.${Date.now()}.bak.json`);
        fs.copyFileSync(dbFile, backupFile);
      }
    } catch {
      // non-fatal on restricted fs
    }
  }

  const stats = await withJsonTransaction((db) => {
    const auditResult = runSafeIdentityAuditCore({
      users: db.users || [],
      employees: db.employees || [],
      customers: db.customers || [],
      representatives: db.representatives || [],
      suppliers: db.suppliers || [],
      existingIdentities: db.identities || [],
      existingRoles: db.identityRoles || [],
      existingConflicts: db.identityConflicts || [],
    });

    db.identities = auditResult.identities;
    db.identityRoles = auditResult.identityRoles;
    db.identityConflicts = auditResult.conflicts;

    for (const u of db.users || []) {
      const upd = auditResult.recordUpdates.users.get(u.id);
      if (upd) {
        u.identityId = upd.identityId;
        if (!u.employeeId && upd.employeeId) u.employeeId = upd.employeeId;
      }
    }
    for (const e of db.employees || []) {
      const upd = auditResult.recordUpdates.employees.get(e.id);
      if (upd) {
        e.identityId = upd.identityId;
        if (!e.userId && upd.userId) e.userId = upd.userId;
      }
    }
    for (const c of db.customers || []) {
      const upd = auditResult.recordUpdates.customers.get(c.id);
      if (upd) c.identityId = upd.identityId;
    }
    for (const r of db.representatives || []) {
      const upd = auditResult.recordUpdates.representatives.get(r.id);
      if (upd) r.identityId = upd.identityId;
    }
    for (const s of db.suppliers || []) {
      const upd = auditResult.recordUpdates.suppliers.get(s.id);
      if (upd) {
        s.identityId = upd.identityId;
        if (!s.userId && upd.userId) s.userId = upd.userId;
      }
    }

    return auditResult.stats;
  });

  return { ok: true, mode: 'json', executedBy, backupFile, ...stats };
}

export async function listIdentitiesOverview() {
  if (await isPgMode()) {
    const pool = getPool();
    const [idnRes, roleRes, cfRes] = await Promise.all([
      pool.query(`SELECT * FROM identities ORDER BY created_at DESC`),
      pool.query(`SELECT * FROM identity_roles ORDER BY created_at ASC`),
      pool.query(`SELECT * FROM identity_conflicts ORDER BY created_at DESC`),
    ]);
    const rolesByIdn = new Map();
    for (const r of roleRes.rows || []) {
      const mapped = mapPgIdentityRoleRow(r);
      const arr = rolesByIdn.get(mapped.identityId) || [];
      arr.push(mapped);
      rolesByIdn.set(mapped.identityId, arr);
    }
    const identities = (idnRes.rows || []).map((row) => {
      const idn = mapPgIdentityRow(row);
      idn.roles = rolesByIdn.get(idn.id) || [];
      return idn;
    });
    const conflicts = (cfRes.rows || []).map(mapPgConflictRow);
    return { identities, identityRoles: (roleRes.rows || []).map(mapPgIdentityRoleRow), conflicts };
  }

  const db = readJsonDatabase();
  const rolesByIdn = new Map();
  for (const r of db.identityRoles || []) {
    const arr = rolesByIdn.get(r.identityId) || [];
    arr.push(r);
    rolesByIdn.set(r.identityId, arr);
  }
  const identities = (db.identities || []).map((idn) => ({
    ...idn,
    roles: rolesByIdn.get(idn.id) || [],
  }));
  return {
    identities,
    identityRoles: db.identityRoles || [],
    conflicts: db.identityConflicts || [],
  };
}

export async function linkEntityToIdentityManual({ targetType, targetId, identityId = null, linkEmployeeId = null, linkUserId = null }, actor) {
  if (!ALLOWED_ENTITY_TYPES.has(targetType) || !targetId) {
    throw new AppError(400, 'بيانات السجل المطلوب ربطه غير مكتملة', 'INVALID_LINK_PAYLOAD');
  }
  const now = nowIso();

  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      const table = ENTITY_TYPE_TO_TABLE[targetType];
      const targetRes = await client.query(`SELECT * FROM ${table} WHERE id = $1 LIMIT 1`, [targetId]);
      const target = targetRes.rows[0];
      if (!target) throw new AppError(404, 'السجل المطلوب ربطه غير موجود', 'ENTITY_NOT_FOUND');

      const resolvedIdentityId = await attachRecordToIdentityPgTx(client, {
        entityType: targetType,
        entityId: targetId,
        fullName: target.full_name || target.name || targetId,
        phone: target.phone || '',
        nationalId: target.national_id || '',
        address: target.address || '',
        explicitIdentityId: identityId || null,
        linkedEmployeeId: linkEmployeeId || null,
        linkedUserId: linkUserId || null,
        now,
      });

      if (targetType === 'user' && linkEmployeeId) {
        await client.query(`UPDATE users SET employee_id = $1, updated_at = $2 WHERE id = $3`, [linkEmployeeId, now, targetId]);
        await client.query(`UPDATE employees SET user_id = $1, identity_id = $2 WHERE id = $3`, [targetId, resolvedIdentityId, linkEmployeeId]);
      } else if (targetType === 'employee' && linkUserId) {
        await client.query(`UPDATE employees SET user_id = $1 WHERE id = $2`, [linkUserId, targetId]);
        await client.query(`UPDATE users SET employee_id = $1, identity_id = $2, updated_at = $3 WHERE id = $4`, [targetId, resolvedIdentityId, now, linkUserId]);
      } else if (targetType === 'supplier' && linkUserId) {
        await client.query(`UPDATE suppliers SET user_id = $1 WHERE id = $2`, [linkUserId, targetId]);
      } else if ((targetType === 'customer' || targetType === 'representative') && linkUserId) {
        await client.query(`UPDATE ${table} SET user_id = $1 WHERE id = $2`, [linkUserId, targetId]);
      }

      return { identityId: resolvedIdentityId };
    });
    return { ok: true, ...result, linkedBy: actor?.fullName };
  }

  const result = await withJsonTransaction((db) => {
    const listKey =
      targetType === 'user'
        ? 'users'
        : targetType === 'employee'
        ? 'employees'
        : targetType === 'representative'
        ? 'representatives'
        : targetType === 'customer'
        ? 'customers'
        : 'suppliers';
    const target = (db[listKey] || []).find((x) => x.id === targetId);
    if (!target) throw new AppError(404, 'السجل المطلوب ربطه غير موجود', 'ENTITY_NOT_FOUND');

    const resolvedIdentityId = attachRecordToIdentityJsonTx(db, {
      entityType: targetType,
      entityId: targetId,
      fullName: target.fullName || target.name || targetId,
      phone: target.phone || '',
      nationalId: target.nationalId || '',
      address: target.address || '',
      explicitIdentityId: identityId || null,
      linkedEmployeeId: linkEmployeeId || null,
      linkedUserId: linkUserId || null,
      now,
    });

    if (targetType === 'user' && linkEmployeeId) {
      target.employeeId = linkEmployeeId;
      const emp = (db.employees || []).find((e) => e.id === linkEmployeeId);
      if (emp) {
        emp.userId = targetId;
        emp.identityId = resolvedIdentityId;
      }
    } else if (targetType === 'employee' && linkUserId) {
      target.userId = linkUserId;
      const usr = (db.users || []).find((u) => u.id === linkUserId);
      if (usr) {
        usr.employeeId = targetId;
        usr.identityId = resolvedIdentityId;
      }
    } else if (linkUserId) {
      target.userId = linkUserId;
    }

    return { identityId: resolvedIdentityId };
  });

  return { ok: true, ...result, linkedBy: actor?.fullName };
}

export async function resolveIdentityConflictManual(conflictId, { status = 'resolved', resolutionNotes = '' }, actor) {
  const allowedStatuses = new Set(['resolved', 'dismissed', 'pending_review']);
  if (!allowedStatuses.has(status)) {
    throw new AppError(400, 'حالة معالجة التعارض غير صالحة', 'INVALID_CONFLICT_STATUS');
  }
  const now = nowIso();

  if (await isPgMode()) {
    const updated = await withTransaction(async (client) => {
      const existing = await client.query(`SELECT * FROM identity_conflicts WHERE id = $1 FOR UPDATE`, [conflictId]);
      if (!existing.rows[0]) throw new AppError(404, 'سجل التعارض غير موجود', 'CONFLICT_NOT_FOUND');
      await client.query(
        `UPDATE identity_conflicts SET status = $1, resolution_notes = $2, resolved_by = $3, resolved_at = $4 WHERE id = $5`,
        [status, resolutionNotes || '', status === 'pending_review' ? null : (actor?.fullName || actor?.id || 'admin'), status === 'pending_review' ? null : now, conflictId]
      );
      const r = await client.query(`SELECT * FROM identity_conflicts WHERE id = $1`, [conflictId]);
      return mapPgConflictRow(r.rows[0]);
    });
    return { ok: true, conflict: updated };
  }

  const updated = await withJsonTransaction((db) => {
    const cf = (db.identityConflicts || []).find((c) => c.id === conflictId);
    if (!cf) throw new AppError(404, 'سجل التعارض غير موجود', 'CONFLICT_NOT_FOUND');
    cf.status = status;
    cf.resolutionNotes = resolutionNotes || '';
    if (status === 'pending_review') {
      cf.resolvedBy = undefined;
      cf.resolvedAt = undefined;
    } else {
      cf.resolvedBy = actor?.fullName || actor?.id || 'admin';
      cf.resolvedAt = now;
    }
    return cf;
  });

  return { ok: true, conflict: updated };
}

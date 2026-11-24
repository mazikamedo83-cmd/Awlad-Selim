import { getPool, withTransaction } from '../postgres.js';
import {
  withJsonTransaction,
  readJsonDatabase,
  readJsonIdempotency,
  writeJsonIdempotency,
  nextJsonSequence,
} from '../jsonLedger.js';
import { generateServerId } from '../../utils/crypto.js';
import { AppError, nowIso, todayIso, round2 } from '../../utils/errors.js';
import { isPgMode, isoDateOnly, isoTimestamp } from './mode.js';
import { recordAuditLog } from './authStore.js';
import { resolveActorIdentityPgTx, resolveActorIdentityJsonTx } from '../identityManager.js';

function mapPgAccount(r) {
  return {
    id: r.id,
    ownerName: r.owner_name,
    accountName: r.account_name,
    description: r.description || '',
    openingBalance: Number(r.opening_balance || 0),
    currentBalance: Number(r.current_balance || 0),
    status: r.status || 'active',
    notes: r.notes || '',
    createdBy: r.created_by || 'النظام',
    createdAt: isoTimestamp(r.created_at),
    updatedAt: isoTimestamp(r.updated_at),
  };
}

function mapPgTx(r) {
  return {
    id: r.id,
    txNumber: r.tx_number,
    accountId: r.account_id,
    accountName: r.account_name,
    ownerName: r.owner_name,
    type: r.type,
    amount: Number(r.amount || 0),
    date: isoDateOnly(r.date),
    cashboxId: r.cashbox_id || undefined,
    cashboxName: r.cashbox_name || undefined,
    balanceBefore: Number(r.balance_before || 0),
    balanceAfter: Number(r.balance_after || 0),
    notes: r.notes || '',
    reason: r.reason || '',
    status: r.status || 'active',
    idempotencyKey: r.idempotency_key || undefined,
    createdByUserId: r.created_by_user_id || undefined,
    createdBy: r.created_by || 'النظام',
    editedBy: r.edited_by || undefined,
    editedAt: r.edited_at ? isoTimestamp(r.edited_at) : undefined,
    createdAt: isoTimestamp(r.created_at),
  };
}

function getTxDelta(type, amount) {
  // personal_deposit, opening_balance -> increases owner personal account balance
  // personal_withdrawal, personal_expense -> decreases owner personal account balance
  // adjustment -> signed amount directly (positive increases, negative decreases)
  if (type === 'personal_deposit' || type === 'opening_balance') return round2(Math.abs(amount));
  if (type === 'personal_withdrawal' || type === 'personal_expense') return round2(-Math.abs(amount));
  if (type === 'adjustment') return round2(amount);
  throw new AppError(400, 'نوع الحركة الشخصية غير صالح', 'INVALID_TX_TYPE');
}

export async function listPersonalAccountsData() {
  if (await isPgMode()) {
    const pool = getPool();
    const [accRes, txRes] = await Promise.all([
      pool.query('SELECT * FROM owner_accounts ORDER BY created_at DESC'),
      pool.query('SELECT * FROM owner_transactions ORDER BY date DESC, created_at DESC LIMIT 2000'),
    ]);
    return {
      accounts: accRes.rows.map(mapPgAccount),
      transactions: txRes.rows.map(mapPgTx),
    };
  }
  const db = readJsonDatabase();
  return {
    accounts: [...(db.ownerAccounts || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    transactions: [...(db.ownerTransactions || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  };
}

export async function createPersonalAccount(payload, actor) {
  const ownerName = String(payload.ownerName || '').trim();
  const accountName = String(payload.accountName || '').trim();
  if (!ownerName || !accountName) {
    throw new AppError(400, 'يرجى إدخال اسم المالك واسم الحساب الشخصي', 'INVALID_OWNER_ACCOUNT');
  }

  const openingBalance = round2(payload.openingBalance ?? 0);
  const id = generateServerId('OWN');
  const now = nowIso();
  const dateStr = todayIso();

  if (await isPgMode()) {
    const account = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO owner_accounts (id, owner_name, account_name, description, opening_balance, current_balance, status, notes, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$9)`,
        [id, ownerName, accountName, payload.description || '', openingBalance, payload.status || 'active', payload.notes || '', actor.fullName, now]
      );
      if (openingBalance !== 0) {
        const seqRes = await client.query(`SELECT nextval('seq_owner_tx_no') AS n`);
        const txNo = `OTX-${String(seqRes.rows[0].n).padStart(5, '0')}`;
        await client.query(
          `INSERT INTO owner_transactions (id, tx_number, account_id, account_name, owner_name, type, amount, date, cashbox_id, cashbox_name, balance_before, balance_after, notes, reason, status, created_by_user_id, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,'opening_balance',$6,$7,NULL,'',0,$6,'رصيد افتتاحي للحساب الشخصي','تأسيس الحساب','active',$8,$9,$10)`,
          [generateServerId('OTX'), txNo, id, accountName, ownerName, openingBalance, dateStr, actor.id, actor.fullName, now]
        );
      }
      const res = await client.query('SELECT * FROM owner_accounts WHERE id = $1', [id]);
      return mapPgAccount(res.rows[0]);
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `إنشاء حساب شخصي للمالك (${ownerName} - ${accountName})`,
      module: 'الحسابات الشخصية للملاك',
      recordId: id,
      newValues: { ownerName, accountName, openingBalance },
    });
    return account;
  }

  const account = await withJsonTransaction((db) => {
    const acc = {
      id,
      ownerName,
      accountName,
      description: payload.description || '',
      openingBalance,
      currentBalance: openingBalance,
      status: payload.status || 'active',
      notes: payload.notes || '',
      createdBy: actor.fullName,
      createdAt: now,
      updatedAt: now,
    };
    db.ownerAccounts.unshift(acc);
    if (openingBalance !== 0) {
      const seq = nextJsonSequence(db, 'ownerTxNo', db.ownerTransactions, 'txNumber', /^OTX-(\d+)$/i);
      db.ownerTransactions.unshift({
        id: generateServerId('OTX'),
        txNumber: `OTX-${String(seq).padStart(5, '0')}`,
        accountId: id,
        accountName,
        ownerName,
        type: 'opening_balance',
        amount: openingBalance,
        date: dateStr,
        balanceBefore: 0,
        balanceAfter: openingBalance,
        notes: 'رصيد افتتاحي للحساب الشخصي',
        reason: 'تأسيس الحساب',
        status: 'active',
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        createdAt: now,
      });
    }
    return acc;
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `إنشاء حساب شخصي للمالك (${ownerName} - ${accountName})`,
    module: 'الحسابات الشخصية للملاك',
    recordId: id,
    newValues: { ownerName, accountName, openingBalance },
  });
  return account;
}

export async function updatePersonalAccount(id, updates, actor) {
  const now = nowIso();
  if (await isPgMode()) {
    const account = await withTransaction(async (client) => {
      const existing = await client.query('SELECT * FROM owner_accounts WHERE id = $1 FOR UPDATE', [id]);
      if (!existing.rows[0]) throw new AppError(404, 'الحساب الشخصي غير موجود', 'NOT_FOUND');
      const cur = existing.rows[0];
      await client.query(
        `UPDATE owner_accounts SET owner_name=$1, account_name=$2, description=$3, status=$4, notes=$5, updated_at=$6 WHERE id=$7`,
        [
          updates.ownerName ?? cur.owner_name,
          updates.accountName ?? cur.account_name,
          updates.description ?? cur.description,
          updates.status ?? cur.status,
          updates.notes ?? cur.notes,
          now,
          id,
        ]
      );
      const next = await client.query('SELECT * FROM owner_accounts WHERE id = $1', [id]);
      return mapPgAccount(next.rows[0]);
    });
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تحديث بيانات الحساب الشخصي (${account.accountName})`,
      module: 'الحسابات الشخصية للملاك',
      recordId: id,
      newValues: updates,
    });
    return account;
  }

  const account = await withJsonTransaction((db) => {
    const idx = db.ownerAccounts.findIndex((a) => a.id === id);
    if (idx === -1) throw new AppError(404, 'الحساب الشخصي غير موجود', 'NOT_FOUND');
    const cur = db.ownerAccounts[idx];
    db.ownerAccounts[idx] = {
      ...cur,
      ownerName: updates.ownerName ?? cur.ownerName,
      accountName: updates.accountName ?? cur.accountName,
      description: updates.description ?? cur.description,
      status: updates.status ?? cur.status,
      notes: updates.notes ?? cur.notes,
      id,
      currentBalance: cur.currentBalance, // balance is only modified via ledger transactions
      updatedAt: now,
    };
    return db.ownerAccounts[idx];
  });
  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تحديث بيانات الحساب الشخصي (${account.accountName})`,
    module: 'الحسابات الشخصية للملاك',
    recordId: id,
    newValues: updates,
  });
  return account;
}

export async function createPersonalTransaction(accountId, payload, actor, idempotencyKey = '') {
  const type = String(payload.type || '').trim();
  const rawAmt = Number(payload.amount || 0);
  if (!Number.isFinite(rawAmt) || rawAmt === 0) {
    throw new AppError(400, 'يرجى إدخال مبلغ صحيح للحركة الشخصية', 'INVALID_AMOUNT');
  }
  if (type !== 'adjustment' && rawAmt < 0) {
    throw new AppError(400, 'المبلغ يجب أن يكون موجباً', 'INVALID_AMOUNT');
  }
  if (type === 'adjustment') {
    if (actor.role !== 'admin' && !actor.permissions?.canApprovePersonalAdjustment) {
      throw new AppError(403, 'تحتاج لصلاحية اعتماد تسوية حساب المالك لتسجيل قيد تسوية', 'FORBIDDEN_ADJUSTMENT');
    }
    if (!String(payload.reason || payload.notes || '').trim()) {
      throw new AppError(400, 'يجب كتابة سبب واضح لعملية التسوية الشخصية', 'REASON_REQUIRED');
    }
  }

  const delta = getTxDelta(type, rawAmt);
  const absAmt = round2(Math.abs(rawAmt));
  const dateStr = payload.date || todayIso();
  const notes = String(payload.notes || '').trim();
  const reason = String(payload.reason || '').trim();
  const cashboxId = type === 'adjustment' ? null : (payload.cashboxId || null);
  const cleanIdem = idempotencyKey ? String(idempotencyKey).trim() : null;
  const now = nowIso();
  const txId = generateServerId('OTX');

  if (await isPgMode()) {
    const result = await withTransaction(async (client) => {
      if (cleanIdem) {
        const dup = await client.query('SELECT response_json FROM idempotency_keys WHERE key_id = $1 LIMIT 1', [cleanIdem]);
        if (dup.rows[0]) {
          return { deduplicated: true, transaction: dup.rows[0].response_json.transaction, account: dup.rows[0].response_json.account };
        }
      }

      const accRes = await client.query('SELECT * FROM owner_accounts WHERE id = $1 FOR UPDATE', [accountId]);
      const acc = accRes.rows[0];
      if (!acc) throw new AppError(404, 'الحساب الشخصي غير موجود', 'NOT_FOUND');
      if (acc.status !== 'active') throw new AppError(409, 'هذا الحساب الشخصي موقوف ولا يقبل حركات جديدة', 'ACCOUNT_SUSPENDED');

      let cbName = '';
      if (cashboxId) {
        const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [cashboxId]);
        const cb = cbRes.rows[0];
        if (!cb) throw new AppError(404, 'الخزينة المرتبطة غير موجودة', 'CASHBOX_NOT_FOUND');
        cbName = cb.name;
        const cbCur = Number(cb.current_balance || 0);
        if ((type === 'personal_withdrawal' || type === 'personal_expense') && cbCur < absAmt) {
          throw new AppError(409, `رصيد الخزينة (${cb.name}) غير كافٍ للسحب الشخصي`, 'INSUFFICIENT_CASHBOX');
        }
        const cbNext = round2(cbCur + delta);
        await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [cbNext, cashboxId]);
        const actorCtx = await resolveActorIdentityPgTx(client, actor);
        await client.query(
          `INSERT INTO financial_transactions (id, transaction_number, date, type, amount, cashbox_id, cashbox_name, balance_after, category, related_entity_type, related_entity_id, related_entity_name, related_doc_type, related_doc_id, description, notes, created_by_user_id, created_by, actor_identity_id, actor_employee_id, acting_role, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'owner_account',$10,$11,'manual',$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
          [
            generateServerId('FT'),
            `OWN-${Date.now().toString().slice(-6)}`,
            dateStr,
            delta >= 0 ? 'deposit' : 'withdrawal',
            absAmt,
            cashboxId,
            cbName,
            cbNext,
            type === 'personal_deposit' ? 'إيداع شخصي للمالك' : type === 'personal_expense' ? 'مصروف شخصي للمالك' : 'مسحوبات شخصية للمالك',
            accountId,
            `${acc.owner_name} (${acc.account_name})`,
            txId,
            `${type === 'personal_deposit' ? 'إيداع شخصي' : type === 'personal_expense' ? 'مصروف شخصي' : 'سحب شخصي'} - ${acc.account_name}`,
            notes,
            actor.id,
            actor.fullName,
            actorCtx.actorIdentityId || null,
            actorCtx.actorEmployeeId || null,
            actorCtx.actingRole || actor.role || null,
            now,
          ]
        );
      }

      const seqRes = await client.query(`SELECT nextval('seq_owner_tx_no') AS n`);
      const txNumber = `OTX-${String(seqRes.rows[0].n).padStart(5, '0')}`;
      const balBefore = Number(acc.current_balance || 0);
      const balAfter = round2(balBefore + delta);

      await client.query('UPDATE owner_accounts SET current_balance = $1, updated_at = $2 WHERE id = $3', [balAfter, now, accountId]);
      await client.query(
        `INSERT INTO owner_transactions (id, tx_number, account_id, account_name, owner_name, type, amount, date, cashbox_id, cashbox_name, balance_before, balance_after, notes, reason, status, idempotency_key, created_by_user_id, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15,$16,$17,$18)`,
        [
          txId, txNumber, accountId, acc.account_name, acc.owner_name,
          type, type === 'adjustment' ? delta : absAmt, dateStr,
          cashboxId, cbName, balBefore, balAfter, notes, reason, cleanIdem, actor.id, actor.fullName, now,
        ]
      );

      const txRow = (await client.query('SELECT * FROM owner_transactions WHERE id = $1', [txId])).rows[0];
      const accRow = (await client.query('SELECT * FROM owner_accounts WHERE id = $1', [accountId])).rows[0];
      const out = { deduplicated: false, transaction: mapPgTx(txRow), account: mapPgAccount(accRow) };

      if (cleanIdem) {
        await client.query(
          `INSERT INTO idempotency_keys (key_id, user_id, endpoint, response_json) VALUES ($1,$2,'POST /api/personal-accounts/tx',$3) ON CONFLICT (key_id) DO NOTHING`,
          [cleanIdem, actor.id, JSON.stringify({ transaction: out.transaction, account: out.account })]
        );
      }
      return out;
    });

    if (!result.deduplicated) {
      await recordAuditLog({
        userId: actor.id,
        userName: actor.fullName,
        action: `تسجيل حركة حساب شخصي (${result.transaction.txNumber} - ${type})`,
        module: 'الحسابات الشخصية للملاك',
        recordId: result.transaction.id,
        oldValues: { balanceBefore: result.transaction.balanceBefore },
        newValues: { amount: result.transaction.amount, balanceAfter: result.transaction.balanceAfter, cashboxId },
        notes: reason || notes,
      });
    }
    return result;
  }

  // JSON Ledger mode
  const result = await withJsonTransaction((db) => {
    if (cleanIdem) {
      const idemMap = readJsonIdempotency();
      if (idemMap[cleanIdem]) {
        return { deduplicated: true, ...idemMap[cleanIdem] };
      }
    }

    const acc = db.ownerAccounts.find((a) => a.id === accountId);
    if (!acc) throw new AppError(404, 'الحساب الشخصي غير موجود', 'NOT_FOUND');
    if (acc.status !== 'active') throw new AppError(409, 'هذا الحساب الشخصي موقوف ولا يقبل حركات جديدة', 'ACCOUNT_SUSPENDED');

    let cbName = '';
    if (cashboxId) {
      const cb = db.cashboxes.find((c) => c.id === cashboxId);
      if (!cb) throw new AppError(404, 'الخزينة المرتبطة غير موجودة', 'CASHBOX_NOT_FOUND');
      cbName = cb.name;
      if ((type === 'personal_withdrawal' || type === 'personal_expense') && Number(cb.currentBalance || 0) < absAmt) {
        throw new AppError(409, `رصيد الخزينة (${cb.name}) غير كافٍ للسحب الشخصي`, 'INSUFFICIENT_CASHBOX');
      }
      cb.currentBalance = round2(Number(cb.currentBalance || 0) + delta);
      const actorCtxJson = resolveActorIdentityJsonTx(db, actor);
      db.financialTransactions.unshift({
        id: generateServerId('FT'),
        transactionNumber: `OWN-${Date.now().toString().slice(-6)}`,
        date: dateStr,
        type: delta >= 0 ? 'deposit' : 'withdrawal',
        cashboxId: cb.id,
        cashboxName: cb.name,
        balanceAfter: cb.currentBalance,
        amount: absAmt,
        category: type === 'personal_deposit' ? 'إيداع شخصي للمالك' : type === 'personal_expense' ? 'مصروف شخصي للمالك' : 'مسحوبات شخصية للمالك',
        relatedDocType: 'manual',
        relatedDocId: txId,
        partyId: acc.id,
        partyName: `${acc.ownerName} (${acc.accountName})`,
        description: `${type === 'personal_deposit' ? 'إيداع شخصي' : type === 'personal_expense' ? 'مصروف شخصي' : 'سحب شخصي'} - ${acc.accountName}`,
        notes,
        createdByUserId: actor.id,
        createdBy: actor.fullName,
        actorIdentityId: actorCtxJson.actorIdentityId,
        actorEmployeeId: actorCtxJson.actorEmployeeId,
        actingRole: actorCtxJson.actingRole,
        createdAt: now,
      });
    }

    const seq = nextJsonSequence(db, 'ownerTxNo', db.ownerTransactions, 'txNumber', /^OTX-(\d+)$/i);
    const txNumber = `OTX-${String(seq).padStart(5, '0')}`;
    const balBefore = Number(acc.currentBalance || 0);
    const balAfter = round2(balBefore + delta);
    acc.currentBalance = balAfter;
    acc.updatedAt = now;

    const tx = {
      id: txId,
      txNumber,
      accountId,
      accountName: acc.accountName,
      ownerName: acc.ownerName,
      type,
      amount: type === 'adjustment' ? delta : absAmt,
      date: dateStr,
      cashboxId: cashboxId || undefined,
      cashboxName: cbName || undefined,
      balanceBefore: balBefore,
      balanceAfter: balAfter,
      notes,
      reason,
      status: 'active',
      idempotencyKey: cleanIdem || undefined,
      createdByUserId: actor.id,
      createdBy: actor.fullName,
      createdAt: now,
    };
    db.ownerTransactions.unshift(tx);

    if (cleanIdem) {
      const idemMap = readJsonIdempotency();
      idemMap[cleanIdem] = { transaction: tx, account: acc };
      writeJsonIdempotency(idemMap);
    }
    return { deduplicated: false, transaction: tx, account: acc };
  });

  if (!result.deduplicated) {
    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تسجيل حركة حساب شخصي (${result.transaction.txNumber} - ${type})`,
      module: 'الحسابات الشخصية للملاك',
      recordId: result.transaction.id,
      oldValues: { balanceBefore: result.transaction.balanceBefore },
      newValues: { amount: result.transaction.amount, balanceAfter: result.transaction.balanceAfter, cashboxId },
      notes: reason || notes,
    });
  }
  return result;
}

export async function editPersonalTransaction(txId, updates, actor) {
  const reason = String(updates.reason || '').trim();
  if (!reason) {
    throw new AppError(400, 'يجب كتابة سبب تعديل الحركة الشخصية لتوثيقه في سجل المراجعة', 'REASON_REQUIRED');
  }
  const now = nowIso();

  if (await isPgMode()) {
    const out = await withTransaction(async (client) => {
      const txRes = await client.query('SELECT * FROM owner_transactions WHERE id = $1 FOR UPDATE', [txId]);
      const oldTx = txRes.rows[0];
      if (!oldTx) throw new AppError(404, 'الحركة غير موجودة', 'NOT_FOUND');

      const accRes = await client.query('SELECT * FROM owner_accounts WHERE id = $1 FOR UPDATE', [oldTx.account_id]);
      const acc = accRes.rows[0];

      const oldDelta = getTxDelta(oldTx.type, Number(oldTx.amount));
      const newRawAmt = updates.amount !== undefined ? Number(updates.amount) : Number(oldTx.amount);
      if (!Number.isFinite(newRawAmt) || newRawAmt === 0) throw new AppError(400, 'مبلغ غير صالح', 'INVALID_AMOUNT');
      const newDelta = getTxDelta(oldTx.type, newRawAmt);
      const diffDelta = round2(newDelta - oldDelta);

      if (diffDelta !== 0 && oldTx.cashbox_id) {
        const cbRes = await client.query('SELECT * FROM cashboxes WHERE id = $1 FOR UPDATE', [oldTx.cashbox_id]);
        if (cbRes.rows[0]) {
          const nextCb = round2(Number(cbRes.rows[0].current_balance) + diffDelta);
          if (nextCb < 0) throw new AppError(409, 'تعديل المبلغ يجعل رصيد الخزينة سالباً', 'INSUFFICIENT_CASHBOX');
          await client.query('UPDATE cashboxes SET current_balance = $1 WHERE id = $2', [nextCb, oldTx.cashbox_id]);
        }
      }

      const nextAccBal = round2(Number(acc.current_balance) + diffDelta);
      await client.query('UPDATE owner_accounts SET current_balance = $1, updated_at = $2 WHERE id = $3', [nextAccBal, now, acc.id]);
      await client.query(
        `UPDATE owner_transactions SET amount = $1, date = $2, notes = $3, reason = $4, balance_after = balance_after + $5, edited_by = $6, edited_at = $7 WHERE id = $8`,
        [
          oldTx.type === 'adjustment' ? newDelta : round2(Math.abs(newRawAmt)),
          updates.date || oldTx.date,
          updates.notes ?? oldTx.notes,
          reason,
          diffDelta,
          actor.fullName,
          now,
          txId,
        ]
      );

      const newTx = (await client.query('SELECT * FROM owner_transactions WHERE id = $1', [txId])).rows[0];
      const newAcc = (await client.query('SELECT * FROM owner_accounts WHERE id = $1', [acc.id])).rows[0];
      return { oldValues: mapPgTx(oldTx), transaction: mapPgTx(newTx), account: mapPgAccount(newAcc) };
    });

    await recordAuditLog({
      userId: actor.id,
      userName: actor.fullName,
      action: `تعديل حركة شخصية (${out.transaction.txNumber})`,
      module: 'الحسابات الشخصية للملاك',
      recordId: txId,
      oldValues: out.oldValues,
      newValues: out.transaction,
      notes: reason,
    });
    return { transaction: out.transaction, account: out.account };
  }

  const out = await withJsonTransaction((db) => {
    const idx = db.ownerTransactions.findIndex((t) => t.id === txId);
    if (idx === -1) throw new AppError(404, 'الحركة غير موجودة', 'NOT_FOUND');
    const oldTx = { ...db.ownerTransactions[idx] };
    const acc = db.ownerAccounts.find((a) => a.id === oldTx.accountId);
    if (!acc) throw new AppError(404, 'الحساب غير موجود', 'NOT_FOUND');

    const oldDelta = getTxDelta(oldTx.type, Number(oldTx.amount));
    const newRawAmt = updates.amount !== undefined ? Number(updates.amount) : Number(oldTx.amount);
    if (!Number.isFinite(newRawAmt) || newRawAmt === 0) throw new AppError(400, 'مبلغ غير صالح', 'INVALID_AMOUNT');
    const newDelta = getTxDelta(oldTx.type, newRawAmt);
    const diffDelta = round2(newDelta - oldDelta);

    if (diffDelta !== 0 && oldTx.cashboxId) {
      const cb = db.cashboxes.find((c) => c.id === oldTx.cashboxId);
      if (cb) {
        const nextCb = round2(Number(cb.currentBalance) + diffDelta);
        if (nextCb < 0) throw new AppError(409, 'تعديل المبلغ يجعل رصيد الخزينة سالباً', 'INSUFFICIENT_CASHBOX');
        cb.currentBalance = nextCb;
      }
    }

    acc.currentBalance = round2(Number(acc.currentBalance) + diffDelta);
    acc.updatedAt = now;

    const updatedTx = {
      ...oldTx,
      amount: oldTx.type === 'adjustment' ? newDelta : round2(Math.abs(newRawAmt)),
      date: updates.date || oldTx.date,
      notes: updates.notes ?? oldTx.notes,
      reason,
      balanceAfter: round2(Number(oldTx.balanceAfter) + diffDelta),
      editedBy: actor.fullName,
      editedAt: now,
    };
    db.ownerTransactions[idx] = updatedTx;
    return { oldValues: oldTx, transaction: updatedTx, account: acc };
  });

  await recordAuditLog({
    userId: actor.id,
    userName: actor.fullName,
    action: `تعديل حركة شخصية (${out.transaction.txNumber})`,
    module: 'الحسابات الشخصية للملاك',
    recordId: txId,
    oldValues: out.oldValues,
    newValues: out.transaction,
    notes: reason,
  });
  return { transaction: out.transaction, account: out.account };
}

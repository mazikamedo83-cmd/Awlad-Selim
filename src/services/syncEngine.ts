import type {
  DispatchRecipientOption,
  SyncConflictRecord,
  SyncDispatchBatch,
  SyncDispatchBatchStatus,
  SyncOperationType,
  SyncQueueItem,
} from '../types';
import { apiRequest } from './api';
import { localDb } from './localDb';
import { getOrCreatePersistentDeviceId } from './native';
import { logDiagnostic } from './diagnostics';

export type SyncCycleMode = 'full' | 'send_only' | 'receive_only';

export interface SyncRefreshSummary {
  at: string;
  count: number;
  failedCount?: number;
  conflictCount?: number;
  ok: boolean;
  error?: string;
}

export interface SyncCycleOutcome {
  ok: boolean;
  serverReachable: boolean;
  mode: SyncCycleMode;
  authRevoked?: boolean;
  revokeReason?: string;
  pushedCount: number;
  syncedCount: number;
  failedCount: number;
  conflictCount: number;
  pullData?: any;
  receivedCount?: number;
  error?: string;
}

const activeLocks = new Map<string, Promise<SyncCycleOutcome>>();

function buildOperationId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8).toUpperCase()
      : Math.random().toString(36).slice(2, 10).toUpperCase();
  return `OP-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

export async function enqueueSyncOperation(params: {
  userId: string;
  operationType: SyncOperationType;
  entityType: string;
  entityId?: string;
  localId?: string;
  summaryAr: string;
  payload: Record<string, any>;
  holdForDispatchBatch?: boolean;
  dispatchStage?: SyncDispatchBatchStatus;
}): Promise<SyncQueueItem> {
  const nowIso = new Date().toISOString();
  const item: SyncQueueItem = {
    operationId: buildOperationId(),
    userId: params.userId,
    deviceId: getOrCreatePersistentDeviceId(),
    operationType: params.operationType,
    entityType: params.entityType,
    entityId: params.entityId,
    localId: params.localId,
    summaryAr: params.summaryAr,
    payload: params.payload || {},
    status: 'pending',
    holdForDispatchBatch: Boolean(params.holdForDispatchBatch),
    dispatchStage: params.dispatchStage || (params.holdForDispatchBatch ? 'محفوظة محليًا' : undefined),
    attempts: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await localDb.putSyncOperation(item);
  return item;
}

function isAuthRevokedError(err: any): boolean {
  const code = String(err?.code || '');
  return (
    err?.status === 401 ||
    code === 'DEVICE_REVOKED' ||
    code === 'ACCOUNT_DEACTIVATED' ||
    code === 'ACCOUNT_SUSPENDED' ||
    code === 'SESSION_REVOKED' ||
    code === 'INVALID_TOKEN' ||
    code === 'UNAUTHORIZED'
  );
}

function isUnreachableError(err: any): boolean {
  if (err?.status === 503 || String(err?.code || '') === 'DATABASE_UNAVAILABLE') {
    return false;
  }
  return err?.status === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

function syncMetaKey(base: 'last_send_summary' | 'last_receive_summary' | 'last_sync_at', userId?: string): string {
  const uid = String(userId || '').trim();
  return uid ? `${base}:${uid}` : base;
}

export async function getSyncRefreshStats(userId?: string): Promise<{
  lastSendSummary: SyncRefreshSummary | null;
  lastReceiveSummary: SyncRefreshSummary | null;
}> {
  const [lastSendSummary, lastReceiveSummary] = await Promise.all([
    localDb.getMeta<SyncRefreshSummary>(syncMetaKey('last_send_summary', userId)),
    localDb.getMeta<SyncRefreshSummary>(syncMetaKey('last_receive_summary', userId)),
  ]);
  return {
    lastSendSummary: lastSendSummary || null,
    lastReceiveSummary: lastReceiveSummary || null,
  };
}

async function executeSyncCycle(params: {
  userId: string;
  forceAll?: boolean;
  mode?: SyncCycleMode;
  includeHeldBatches?: boolean;
}): Promise<SyncCycleOutcome> {
  const { userId, forceAll = false, mode = 'full', includeHeldBatches = false } = params;
  const nowMs = Date.now();
  const queue = await localDb.listSyncQueue(userId);

  const dueOperations =
    mode === 'receive_only'
      ? []
      : queue.filter((item) => {
          if (!includeHeldBatches && item.holdForDispatchBatch === true && !item.dispatchBatchId) {
            return false;
          }
          if (item.status === 'pending' || item.status === 'local') return true;
          if (item.status === 'syncing') return true;
          if (item.status === 'failed') {
            if (forceAll) return true;
            return !item.nextRetryAt || nowMs >= item.nextRetryAt;
          }
          return false;
        });

  let pushedCount = 0;
  let syncedCount = 0;
  let failedCount = queue.filter((q) => q.status === 'failed').length;
  let conflictCount = queue.filter((q) => q.status === 'needs_review').length;

  // 1. Push pending local operations first (FIFO order) — NEVER deleted before explicit server ACK
  if (mode !== 'receive_only') {
    if (dueOperations.length > 0) {
      const orderedOps = [...dueOperations].sort((a, b) =>
        String(a.createdAt).localeCompare(String(b.createdAt))
      );

      try {
        const pushRes = await apiRequest<{
          ok: boolean;
          results: Array<{
            operationId: string;
            status: 'synced' | 'failed' | 'needs_review';
            error?: string;
            conflict?: SyncConflictRecord;
            conflictId?: string;
          }>;
        }>('/api/sync/push', {
          method: 'POST',
          body: { operations: orderedOps },
        });

        const resultMap = new Map(
          (Array.isArray(pushRes?.results) ? pushRes.results : []).map((r) => [r.operationId, r])
        );

        const updatedQueue = [...queue];
        const newConflicts: SyncConflictRecord[] = [];
        const updateTimestamp = new Date().toISOString();

        for (let i = 0; i < updatedQueue.length; i += 1) {
          const item = updatedQueue[i];
          const res = resultMap.get(item.operationId);
          if (!res) continue;

          pushedCount += 1;
          if (res.status === 'synced') {
            syncedCount += 1;
            updatedQueue[i] = {
              ...item,
              status: 'synced',
              lastError: undefined,
              nextRetryAt: undefined,
              updatedAt: updateTimestamp,
            };
          } else if (res.status === 'needs_review') {
            if (res.conflict) newConflicts.push(res.conflict);
            updatedQueue[i] = {
              ...item,
              status: 'needs_review',
              attempts: (item.attempts || 0) + 1,
              lastError: res.error || res.conflict?.conflictReason || 'تعارض يحتاج مراجعة يدوية',
              conflictId: res.conflictId || res.conflict?.id || item.conflictId,
              nextRetryAt: undefined,
              updatedAt: updateTimestamp,
            };
          } else {
            const attempts = (item.attempts || 0) + 1;
            const backoffMs = Math.min(300000, Math.pow(2, Math.min(attempts, 6)) * 5000);
            updatedQueue[i] = {
              ...item,
              status: 'failed',
              attempts,
              lastError: res.error || 'تعذر تنفيذ العملية على السيرفر',
              nextRetryAt: Date.now() + backoffMs,
              updatedAt: updateTimestamp,
            };
          }
        }

        await localDb.saveSyncQueue(userId, updatedQueue);
        if (newConflicts.length > 0) {
          const existingConflicts = await localDb.listConflicts(userId);
          const merged = [...newConflicts];
          for (const oldCf of existingConflicts) {
            if (!merged.some((c) => c.id === oldCf.id)) merged.push(oldCf);
          }
          await localDb.saveConflicts(userId, merged);
        }

        failedCount = updatedQueue.filter((q) => q.status === 'failed').length;
        conflictCount = updatedQueue.filter((q) => q.status === 'needs_review').length;

        await localDb.setMeta<SyncRefreshSummary>(syncMetaKey('last_send_summary', userId), {
          at: updateTimestamp,
          count: syncedCount,
          failedCount,
          conflictCount,
          ok: failedCount === 0 && conflictCount === 0,
          error: failedCount > 0 ? 'تعذر إرسال بعض العمليات وبقيت محفوظة لإعادة المحاولة.' : undefined,
        });
        if (failedCount > 0 || newConflicts.length > 0) {
          logDiagnostic({
            category: 'sync_issue',
            severity: failedCount > 0 ? 'error' : 'warning',
            source: 'syncEngine.push',
            message:
              failedCount > 0
                ? `فشل إرسال (${failedCount}) عملية من طابور المزامنة وبقيت محفوظة لإعادة المحاولة`
                : `تم رصد (${newConflicts.length}) تعارض مزامنة يحتاج مراجعة`,
            details: { pushedCount, syncedCount, failedCount, conflictCount, mode },
          });
        }
      } catch (err: any) {
        const errMsg = err?.message || 'تعذر مزامنة العمليات مع قاعدة البيانات المركزية';
        logDiagnostic({
          category: isAuthRevokedError(err) ? 'auth' : 'sync_issue',
          severity: 'error',
          source: 'syncEngine.push',
          message: errMsg,
          details: { status: err?.status, code: err?.code, pendingCount: dueOperations.length, mode },
        });
        if (isAuthRevokedError(err)) {
          return {
            ok: false,
            serverReachable: true,
            mode,
            authRevoked: true,
            revokeReason: err?.message,
            pushedCount: 0,
            syncedCount: 0,
            failedCount,
            conflictCount,
            error: err?.message,
          };
        }
        await localDb.setMeta<SyncRefreshSummary>(syncMetaKey('last_send_summary', userId), {
          at: new Date().toISOString(),
          count: 0,
          failedCount: dueOperations.length,
          conflictCount,
          ok: false,
          error: errMsg,
        });
        if (isUnreachableError(err)) {
          return {
            ok: false,
            serverReachable: false,
            mode,
            pushedCount: 0,
            syncedCount: 0,
            failedCount,
            conflictCount,
            error: err?.message || 'الخادم غير متاح حالياً',
          };
        }
        return {
          ok: false,
          serverReachable: true,
          mode,
          pushedCount: 0,
          syncedCount: 0,
          failedCount,
          conflictCount,
          error: errMsg,
        };
      }
    } else if (mode === 'send_only') {
      // Explicit send with 0 pending ops still verifies server reachability cleanly
      try {
        await apiRequest('/api/sync/push', {
          method: 'POST',
          body: { operations: [] },
        });
        await localDb.setMeta<SyncRefreshSummary>(syncMetaKey('last_send_summary', userId), {
          at: new Date().toISOString(),
          count: 0,
          failedCount: 0,
          conflictCount,
          ok: true,
        });
      } catch (err: any) {
        if (isAuthRevokedError(err)) {
          return {
            ok: false,
            serverReachable: true,
            mode,
            authRevoked: true,
            revokeReason: err?.message,
            pushedCount: 0,
            syncedCount: 0,
            failedCount,
            conflictCount,
            error: err?.message,
          };
        }
        return {
          ok: false,
          serverReachable: !isUnreachableError(err),
          mode,
          pushedCount: 0,
          syncedCount: 0,
          failedCount,
          conflictCount,
          error: err?.message || 'تعذر الاتصال بالسيرفر',
        };
      }
    }

    if (mode === 'send_only') {
      return {
        ok: true,
        serverReachable: true,
        mode,
        pushedCount,
        syncedCount,
        failedCount,
        conflictCount,
      };
    }
  }

  // 2. Pull fresh authoritative state from server
  try {
    const pullData = await apiRequest<any>('/api/sync/pull');
    const nowTime = pullData?.serverTime || new Date().toISOString();
    await localDb.setMeta(syncMetaKey('last_sync_at', userId), nowTime);

    const serverConflicts: SyncConflictRecord[] = Array.isArray(pullData?.syncConflicts)
      ? pullData.syncConflicts
      : [];
    await localDb.saveConflicts(userId, serverConflicts);

    const unresolvedConflicts = serverConflicts.filter((c) => c.status === 'needs_review').length;
    const receivedCount =
      (Array.isArray(pullData?.products) ? pullData.products.length : 0) +
      (Array.isArray(pullData?.repItemTransfers) ? pullData.repItemTransfers.filter((r: any) => r.status === 'executed').length : 0);

    await localDb.setMeta<SyncRefreshSummary>(syncMetaKey('last_receive_summary', userId), {
      at: nowTime,
      count: receivedCount,
      ok: true,
    });

    return {
      ok: true,
      serverReachable: true,
      mode,
      pushedCount,
      syncedCount,
      failedCount,
      conflictCount: Math.max(conflictCount, unresolvedConflicts),
      pullData,
      receivedCount,
    };
  } catch (err: any) {
    logDiagnostic({
      category: isAuthRevokedError(err) ? 'auth' : 'sync_issue',
      severity: 'error',
      source: 'syncEngine.pull',
      message: err?.message || 'تعذر سحب أحدث بيانات من السيرفر',
      details: { status: err?.status, code: err?.code, mode },
    });
    if (isAuthRevokedError(err)) {
      return {
        ok: false,
        serverReachable: true,
        mode,
        authRevoked: true,
        revokeReason: err?.message,
        pushedCount,
        syncedCount,
        failedCount,
        conflictCount,
        error: err?.message,
      };
    }
    await localDb.setMeta<SyncRefreshSummary>(syncMetaKey('last_receive_summary', userId), {
      at: new Date().toISOString(),
      count: 0,
      ok: false,
      error: err?.message || 'تعذر سحب أحدث بيانات من السيرفر',
    });
    return {
      ok: false,
      serverReachable: !isUnreachableError(err),
      mode,
      pushedCount,
      syncedCount,
      failedCount,
      conflictCount,
      error: err?.message || 'تعذر سحب أحدث بيانات من السيرفر',
    };
  }
}

export function runSyncCycle(params: {
  userId: string;
  forceAll?: boolean;
  mode?: SyncCycleMode;
  includeHeldBatches?: boolean;
}): Promise<SyncCycleOutcome> {
  const lockKey = `${params.userId}:${params.mode || 'full'}`;
  const existing = activeLocks.get(lockKey);
  if (existing) return existing;

  const job = executeSyncCycle(params).finally(() => {
    activeLocks.delete(lockKey);
  });
  activeLocks.set(lockKey, job);
  return job;
}

export async function sendDispatchBatchToServer(params: {
  userId: string;
  senderName: string;
  representativeId?: string;
  representativeName?: string;
  selectedOperations: SyncQueueItem[];
  recipient: DispatchRecipientOption;
  notes?: string;
  existingDraftBatch?: SyncDispatchBatch;
}): Promise<{
  ok: boolean;
  batch: SyncDispatchBatch;
  queuedOfflineConfirmed?: boolean;
  authRevoked?: boolean;
  error?: string;
}> {
  const {
    userId,
    senderName,
    representativeId,
    representativeName,
    selectedOperations,
    recipient,
    notes = '',
    existingDraftBatch,
  } = params;
  const deviceId = getOrCreatePersistentDeviceId();
  const now = new Date().toISOString();
  const randSuffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8).toUpperCase()
      : Math.random().toString(36).slice(2, 10).toUpperCase();

  const clientBatchUuid = existingDraftBatch?.clientBatchUuid || `CBU-${Date.now().toString(36).toUpperCase()}-${randSuffix}`;
  const idempotencyKey = existingDraftBatch?.idempotencyKey || clientBatchUuid;
  const draftId = existingDraftBatch?.id || `LOC-DSP-${Date.now().toString(36).toUpperCase()}-${randSuffix}`;
  const orderedOps = [...selectedOperations].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  let salesCount = 0;
  let purchasesCount = 0;
  let returnsCount = 0;
  let collectionsCount = 0;
  let ordersCount = 0;
  let customersCount = 0;
  let custodyOpsCount = 0;
  let totalSalesAmount = 0;
  let totalCashAmount = 0;

  for (const op of orderedOps) {
    const p = op.payload || {};
    if (op.operationType === 'create_sales_invoice') {
      salesCount += 1;
      totalSalesAmount += Number(p.grandTotal || 0);
      totalCashAmount += Number(p.paidAmount || 0);
    } else if (op.operationType === 'create_purchase_invoice' || op.operationType === 'send_purchase_invoice') {
      purchasesCount += 1;
    } else if (
      op.operationType === 'record_customer_payment' ||
      op.operationType === 'add_invoice_payment' ||
      op.operationType === 'record_order_advance'
    ) {
      collectionsCount += 1;
      totalCashAmount += Number(p.amount || 0);
    } else if (op.operationType.includes('return')) {
      returnsCount += 1;
    } else if (op.operationType === 'create_order') {
      ordersCount += 1;
    } else if (op.operationType === 'create_customer' || op.operationType === 'update_customer') {
      customersCount += 1;
    } else if (op.operationType.includes('custody')) {
      custodyOpsCount += 1;
    }
  }

  const sendingDraft: SyncDispatchBatch = {
    id: draftId,
    batchNumber: existingDraftBatch?.batchNumber || `LOC-${clientBatchUuid.slice(-6)}`,
    clientBatchUuid,
    idempotencyKey,
    deviceId,
    senderUserId: userId,
    senderName,
    representativeId,
    representativeName,
    recipientUserId: recipient.id,
    recipientName: recipient.fullName,
    recipientRole: recipient.role,
    sendStatus: 'جاري الإرسال',
    receiptStatus: 'في انتظار الاستلام',
    salesCount,
    purchasesCount,
    returnsCount,
    collectionsCount,
    ordersCount,
    customersCount,
    custodyOpsCount,
    totalSalesAmount: Number(totalSalesAmount.toFixed(2)),
    totalCashAmount: Number(totalCashAmount.toFixed(2)),
    operationIds: orderedOps.map((o) => o.operationId),
    operationsSnapshot: orderedOps,
    notes,
    sentAt: existingDraftBatch?.sentAt || now,
    createdAt: existingDraftBatch?.createdAt || now,
    updatedAt: now,
    isLocalOnly: true,
    isConfirmedSendQueued: true,
  };

  const persistConfirmedOfflineQueue = async (reasonText: string) => {
    const queuedDraft: SyncDispatchBatch = {
      ...sendingDraft,
      sendStatus: 'جاهزة للإرسال',
      errorMessage: reasonText,
      updatedAt: new Date().toISOString(),
      isLocalOnly: true,
      isConfirmedSendQueued: true,
    };
    await localDb.putDispatchBatch(userId, queuedDraft);
    const queue = await localDb.listSyncQueue(userId);
    const updatedQueue = queue.map((q) => {
      if (!orderedOps.some((o) => o.operationId === q.operationId)) return q;
      return {
        ...q,
        dispatchBatchId: queuedDraft.id,
        dispatchStage: 'جاهزة للإرسال' as SyncDispatchBatchStatus,
        lastError: reasonText,
        updatedAt: new Date().toISOString(),
      };
    });
    await localDb.saveSyncQueue(userId, updatedQueue);
    return queuedDraft;
  };

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const queuedMsg = 'طلب الإرسال مؤكد من المرسل — في انتظار المزامنة التلقائية فور عودة الاتصال.';
    const queuedDraft = await persistConfirmedOfflineQueue(queuedMsg);
    return {
      ok: false,
      queuedOfflineConfirmed: true,
      batch: queuedDraft,
      error: queuedMsg,
    };
  }

  // Persist sending draft locally FIRST so disconnects or crashes can resume idempotently
  await localDb.putDispatchBatch(userId, sendingDraft);

  try {
    const res = await apiRequest<{
      ok: boolean;
      deduplicated?: boolean;
      batch: SyncDispatchBatch;
      opResults?: Array<{
        operationId: string;
        status: 'synced' | 'failed' | 'needs_review';
        error?: string;
        conflictId?: string;
        conflict?: SyncConflictRecord;
      }>;
    }>('/api/sync/dispatches', {
      method: 'POST',
      body: {
        clientBatchUuid,
        idempotencyKey,
        deviceId,
        recipientUserId: recipient.id,
        notes,
        operations: orderedOps,
      },
      idempotencyKey,
    });

    const serverBatch: SyncDispatchBatch = {
      ...res.batch,
      isLocalOnly: false,
      isConfirmedSendQueued: false,
    };
    const resultMap = new Map((res.opResults || []).map((r) => [r.operationId, r]));
    const queue = await localDb.listSyncQueue(userId);
    const updatedQueue = queue.map((q) => {
      if (!orderedOps.some((o) => o.operationId === q.operationId)) return q;
      const r = resultMap.get(q.operationId);
      if (!r || r.status === 'synced') {
        return {
          ...q,
          status: 'synced' as const,
          holdForDispatchBatch: false,
          dispatchBatchId: serverBatch.id,
          dispatchStage: 'تم الإرسال' as SyncDispatchBatchStatus,
          lastError: undefined,
          nextRetryAt: undefined,
          updatedAt: new Date().toISOString(),
        };
      }
      if (r.status === 'needs_review') {
        return {
          ...q,
          status: 'needs_review' as const,
          conflictId: r.conflictId || r.conflict?.id || q.conflictId,
          lastError: r.error || 'تعارض يحتاج مراجعة',
          dispatchStage: 'تعذر الاستلام' as SyncDispatchBatchStatus,
          updatedAt: new Date().toISOString(),
        };
      }
      return {
        ...q,
        status: 'failed' as const,
        attempts: (q.attempts || 0) + 1,
        lastError: r.error || 'تعذر تنفيذ العملية ضمن الدفعة',
        dispatchStage: 'فشل الإرسال' as SyncDispatchBatchStatus,
        updatedAt: new Date().toISOString(),
      };
    });

    await localDb.saveSyncQueue(userId, updatedQueue);

    // Replace local draft with authoritative server batch (matching by id or clientBatchUuid)
    const currentBatches = await localDb.listDispatchBatches(userId);
    const filtered = currentBatches.filter(
      (b) => b.id !== draftId && b.id !== serverBatch.id && b.clientBatchUuid !== clientBatchUuid
    );
    filtered.unshift(serverBatch);
    await localDb.saveDispatchBatches(userId, filtered);

    await localDb.setMeta<SyncRefreshSummary>(syncMetaKey('last_send_summary', userId), {
      at: new Date().toISOString(),
      count: orderedOps.length,
      failedCount: 0,
      conflictCount: (res.opResults || []).filter((r) => r.status === 'needs_review').length,
      ok: true,
    });

    return { ok: true, batch: serverBatch };
  } catch (err: any) {
    const authRevoked = isAuthRevokedError(err);
    const statusCode = Number(err?.status || 0);
    const isNetworkUnreachable = !authRevoked && (!statusCode || statusCode === 502 || statusCode === 503 || statusCode === 504);

    if (isNetworkUnreachable) {
      const queuedMsg = 'طلب الإرسال مؤكد من المرسل — في انتظار المزامنة التلقائية فور عودة الاتصال.';
      const queuedDraft = await persistConfirmedOfflineQueue(queuedMsg);
      return {
        ok: false,
        queuedOfflineConfirmed: true,
        batch: queuedDraft,
        error: queuedMsg,
      };
    }

    const errMsg = err?.message || 'تعذر إرسال الدفعة إلى السيرفر — بقيت العمليات محفوظة محليًا ويمكن إعادة الإرسال دون فقد أو تكرار.';
    const failedDraft: SyncDispatchBatch = {
      ...sendingDraft,
      sendStatus: 'فشل الإرسال',
      errorMessage: errMsg,
      updatedAt: new Date().toISOString(),
      isLocalOnly: true,
      isConfirmedSendQueued: false,
    };
    await localDb.putDispatchBatch(userId, failedDraft);

    const queue = await localDb.listSyncQueue(userId);
    const markedQueue = queue.map((q) => {
      if (!orderedOps.some((o) => o.operationId === q.operationId)) return q;
      return {
        ...q,
        dispatchStage: 'فشل الإرسال' as SyncDispatchBatchStatus,
        lastError: errMsg,
        updatedAt: new Date().toISOString(),
      };
    });
    await localDb.saveSyncQueue(userId, markedQueue);

    await localDb.setMeta<SyncRefreshSummary>(syncMetaKey('last_send_summary', userId), {
      at: new Date().toISOString(),
      count: 0,
      failedCount: orderedOps.length,
      conflictCount: 0,
      ok: false,
      error: errMsg,
    });

    return {
      ok: false,
      batch: failedDraft,
      authRevoked,
      error: errMsg,
    };
  }
}


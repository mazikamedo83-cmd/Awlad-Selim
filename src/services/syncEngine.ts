import type { SyncConflictRecord, SyncOperationType, SyncQueueItem } from '../types';
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
}): Promise<SyncCycleOutcome> {
  const { userId, forceAll = false, mode = 'full' } = params;
  const nowMs = Date.now();
  const queue = await localDb.listSyncQueue(userId);

  const dueOperations =
    mode === 'receive_only'
      ? []
      : queue.filter((item) => {
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

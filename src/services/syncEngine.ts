import type { SyncConflictRecord, SyncOperationType, SyncQueueItem } from '../types';
import { apiRequest } from './api';
import { localDb } from './localDb';
import { getOrCreatePersistentDeviceId } from './native';

export interface SyncCycleOutcome {
  ok: boolean;
  serverReachable: boolean;
  authRevoked?: boolean;
  revokeReason?: string;
  pushedCount: number;
  syncedCount: number;
  failedCount: number;
  conflictCount: number;
  pullData?: any;
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
    code === 'SESSION_REVOKED' ||
    code === 'INVALID_TOKEN' ||
    code === 'UNAUTHORIZED'
  );
}

function isUnreachableError(err: any): boolean {
  return err?.status === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

async function executeSyncCycle(params: {
  userId: string;
  forceAll?: boolean;
}): Promise<SyncCycleOutcome> {
  const { userId, forceAll = false } = params;
  const nowMs = Date.now();
  const queue = await localDb.listSyncQueue(userId);

  const dueOperations = queue.filter((item) => {
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

  // 1. Push pending local operations first (FIFO order)
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
    } catch (err: any) {
      if (isAuthRevokedError(err)) {
        return {
          ok: false,
          serverReachable: true,
          authRevoked: true,
          revokeReason: err?.message,
          pushedCount: 0,
          syncedCount: 0,
          failedCount,
          conflictCount,
          error: err?.message,
        };
      }
      if (isUnreachableError(err)) {
        return {
          ok: false,
          serverReachable: false,
          pushedCount: 0,
          syncedCount: 0,
          failedCount,
          conflictCount,
          error: err?.message || 'الخادم غير متاح حالياً',
        };
      }
    }
  }

  // 2. Pull fresh authoritative state from server
  try {
    const pullData = await apiRequest<any>('/api/sync/pull');
    const nowTime = pullData?.serverTime || new Date().toISOString();
    await localDb.setMeta('last_sync_at', nowTime);

    const serverConflicts: SyncConflictRecord[] = Array.isArray(pullData?.syncConflicts)
      ? pullData.syncConflicts
      : [];
    await localDb.saveConflicts(userId, serverConflicts);

    const unresolvedConflicts = serverConflicts.filter((c) => c.status === 'needs_review').length;

    return {
      ok: true,
      serverReachable: true,
      pushedCount,
      syncedCount,
      failedCount,
      conflictCount: Math.max(conflictCount, unresolvedConflicts),
      pullData,
    };
  } catch (err: any) {
    if (isAuthRevokedError(err)) {
      return {
        ok: false,
        serverReachable: true,
        authRevoked: true,
        revokeReason: err?.message,
        pushedCount,
        syncedCount,
        failedCount,
        conflictCount,
        error: err?.message,
      };
    }
    return {
      ok: false,
      serverReachable: !isUnreachableError(err),
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
}): Promise<SyncCycleOutcome> {
  const existing = activeLocks.get(params.userId);
  if (existing) return existing;

  const job = executeSyncCycle(params).finally(() => {
    activeLocks.delete(params.userId);
  });
  activeLocks.set(params.userId, job);
  return job;
}

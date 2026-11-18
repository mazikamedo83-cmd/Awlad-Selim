import { apiRequest, testServerHealth, getConfiguredApiBaseUrl } from './api';
import { localDb } from './localDb';
import { getOrCreatePersistentDeviceId } from './native';
import type {
  SyncConflictRecord,
  SyncOperationType,
  SyncQueueItem,
} from '../types';

export interface EnqueueOperationParams {
  userId: string;
  operationType: SyncOperationType;
  entityType: string;
  entityId?: string;
  localId?: string;
  summaryAr: string;
  payload: Record<string, any>;
}

export interface SyncRunOutcome {
  ok: boolean;
  serverReachable: boolean;
  pushedCount: number;
  syncedCount: number;
  conflictCount: number;
  failedCount: number;
  authRevoked?: boolean;
  revokeReason?: string;
  pullData?: any;
  conflicts?: SyncConflictRecord[];
  error?: string;
}

export function generateOperationId(prefix = 'OP'): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rand}`.toUpperCase();
}

export async function enqueueSyncOperation(params: EnqueueOperationParams): Promise<SyncQueueItem> {
  const now = new Date().toISOString();
  const item: SyncQueueItem = {
    operationId: generateOperationId('OP'),
    userId: params.userId,
    deviceId: getOrCreatePersistentDeviceId(),
    operationType: params.operationType,
    entityType: params.entityType,
    entityId: params.entityId,
    localId: params.localId,
    summaryAr: params.summaryAr,
    payload: {
      ...params.payload,
      originDeviceId: getOrCreatePersistentDeviceId(),
    },
    status: 'pending',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  await localDb.upsertSyncQueueItem(item);
  return item;
}

let activeSyncPromise: Promise<SyncRunOutcome> | null = null;

export async function runSyncCycle(options: {
  userId: string;
  forceAll?: boolean;
}): Promise<SyncRunOutcome> {
  if (activeSyncPromise) return activeSyncPromise;

  activeSyncPromise = (async (): Promise<SyncRunOutcome> => {
    const baseUrl = getConfiguredApiBaseUrl();
    const health = await testServerHealth(baseUrl);
    if (!health.ok) {
      return {
        ok: false,
        serverReachable: false,
        pushedCount: 0,
        syncedCount: 0,
        conflictCount: 0,
        failedCount: 0,
        error: health.error || 'السيرفر المركزي غير متاح حالياً',
      };
    }

    const nowMs = Date.now();
    const queue = await localDb.listSyncQueue(options.userId);
    const eligible = queue.filter((item) => {
      if (item.status === 'synced' || item.status === 'needs_review') return false;
      if (!options.forceAll && item.nextRetryAt && item.nextRetryAt > nowMs) return false;
      return true;
    });

    let pushedCount = 0;
    let syncedCount = 0;
    let conflictCount = 0;
    let failedCount = 0;
    let authRevoked = false;
    let revokeReason = '';

    // Push in chunks of 15 preserving exact creation order
    for (let i = 0; i < eligible.length; i += 15) {
      const chunk = eligible.slice(i, i + 15);
      for (const item of chunk) {
        await localDb.upsertSyncQueueItem({
          ...item,
          status: 'syncing',
          updatedAt: new Date().toISOString(),
        });
      }

      try {
        const res = await apiRequest<{
          ok: boolean;
          stoppedDueToAuthRevoke?: boolean;
          results: Array<{
            operationId: string;
            status: 'synced' | 'needs_review' | 'failed';
            entityId?: string;
            error?: string;
            code?: string;
            conflict?: SyncConflictRecord;
          }>;
          conflicts?: SyncConflictRecord[];
        }>('/api/sync/push', {
          method: 'POST',
          body: {
            deviceId: getOrCreatePersistentDeviceId(),
            operations: chunk.map((c) => ({
              operationId: c.operationId,
              operationType: c.operationType,
              payload: c.payload,
              createdAt: c.createdAt,
            })),
          },
          timeoutMs: 30000,
        });

        pushedCount += chunk.length;
        if (res.stoppedDueToAuthRevoke) {
          authRevoked = true;
          revokeReason = 'تم إيقاف الحساب أو سحب الصلاحية مركزيًا';
        }

        const resultMap = new Map((res.results || []).map((r) => [r.operationId, r]));
        for (const item of chunk) {
          const r = resultMap.get(item.operationId);
          if (!r) {
            failedCount += 1;
            const attempts = item.attempts + 1;
            const backoffMs = Math.min(120000, 5000 * Math.pow(2, attempts - 1));
            await localDb.upsertSyncQueueItem({
              ...item,
              status: 'failed',
              attempts,
              lastError: 'لم يرد تأكيد من السيرفر لهذه العملية',
              nextRetryAt: Date.now() + backoffMs,
              updatedAt: new Date().toISOString(),
            });
            continue;
          }

          if (r.status === 'synced') {
            syncedCount += 1;
            await localDb.upsertSyncQueueItem({
              ...item,
              status: 'synced',
              entityId: r.entityId || item.entityId,
              lastError: undefined,
              nextRetryAt: undefined,
              updatedAt: new Date().toISOString(),
            });
          } else if (r.status === 'needs_review') {
            conflictCount += 1;
            if (r.conflict) {
              await localDb.saveConflicts([r.conflict]);
            }
            await localDb.upsertSyncQueueItem({
              ...item,
              status: 'needs_review',
              conflictId: r.conflict?.id,
              lastError: r.error || 'تعارض يحتاج مراجعة',
              updatedAt: new Date().toISOString(),
            });
          } else {
            failedCount += 1;
            const attempts = item.attempts + 1;
            const backoffMs = Math.min(120000, 5000 * Math.pow(2, attempts - 1));
            await localDb.upsertSyncQueueItem({
              ...item,
              status: 'failed',
              attempts,
              lastError: r.error || 'فشل المزامنة',
              nextRetryAt: Date.now() + backoffMs,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      } catch (err: any) {
        if (err?.status === 401 || err?.code === 'ACCOUNT_DEACTIVATED' || err?.code === 'DEVICE_REVOKED') {
          authRevoked = true;
          revokeReason = err.message;
        }
        for (const item of chunk) {
          failedCount += 1;
          const attempts = item.attempts + 1;
          const backoffMs = Math.min(120000, 5000 * Math.pow(2, attempts - 1));
          await localDb.upsertSyncQueueItem({
            ...item,
            status: err?.status === 0 ? 'pending' : 'failed',
            attempts,
            lastError: err?.message || 'تعذر إرسال دفعة المزامنة',
            nextRetryAt: Date.now() + backoffMs,
            updatedAt: new Date().toISOString(),
          });
        }
        break;
      }
    }

    if (authRevoked) {
      return {
        ok: false,
        serverReachable: true,
        pushedCount,
        syncedCount,
        conflictCount,
        failedCount,
        authRevoked: true,
        revokeReason,
      };
    }

    // Pull authoritative server state after push
    try {
      const pullRes = await apiRequest<any>('/api/sync/pull', { timeoutMs: 30000 });
      if (Array.isArray(pullRes.syncConflicts)) {
        await localDb.replaceServerConflicts(pullRes.syncConflicts);
      }
      await localDb.pruneSyncedQueueItems(options.userId, 50);
      await localDb.setMeta('last_sync_at', pullRes.serverTime || new Date().toISOString());

      return {
        ok: true,
        serverReachable: true,
        pushedCount,
        syncedCount,
        conflictCount,
        failedCount,
        pullData: pullRes,
        conflicts: Array.isArray(pullRes.syncConflicts) ? pullRes.syncConflicts : undefined,
      };
    } catch (err: any) {
      if (err?.status === 401 || err?.code === 'ACCOUNT_DEACTIVATED' || err?.code === 'DEVICE_REVOKED') {
        return {
          ok: false,
          serverReachable: true,
          pushedCount,
          syncedCount,
          conflictCount,
          failedCount,
          authRevoked: true,
          revokeReason: err.message,
        };
      }
      return {
        ok: false,
        serverReachable: true,
        pushedCount,
        syncedCount,
        conflictCount,
        failedCount,
        error: err?.message || 'فشل سحب التحديثات من السيرفر',
      };
    }
  })();

  try {
    return await activeSyncPromise;
  } finally {
    activeSyncPromise = null;
  }
}

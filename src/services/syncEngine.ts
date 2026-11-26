import type {
  DispatchRecipientOption,
  ReceiveConfirmResponse,
  ServerSendSyncResponse,
  ServerUserSyncState,
  SyncConflictRecord,
  SyncDispatchBatch,
  SyncDispatchBatchStatus,
  SyncOperationType,
  SyncQueueItem,
} from '../types';
import {
  apiRequest,
  confirmManualReceiveApi,
  fetchReceivePreviewApi,
  fetchUserSyncStateApi,
  sendManualSyncApi,
} from './api';
import { localDb } from './localDb';
import { getOrCreatePersistentDeviceId } from './native';
import { logDiagnostic } from './diagnostics';
import { getActiveLanguage, tr } from '../i18n/translator';

export type SyncCycleMode = 'full' | 'send_only' | 'receive_only';

export interface SyncRefreshSummary {
  at: string;
  lastAttemptAt?: string;
  count: number;
  failedCount?: number;
  conflictCount?: number;
  ok: boolean;
  isMandatory?: boolean;
  error?: string;
}

export interface SyncProgressUpdate {
  percent: number;
  stage: string;
  completed?: number;
  total?: number;
}

export const DEFAULT_MANDATORY_SEND_INTERVAL_MINUTES = 15;

export function normalizeMandatorySendIntervalMinutes(value?: number | null): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_MANDATORY_SEND_INTERVAL_MINUTES;
  return Math.max(1, Math.min(1440, Math.round(num)));
}

export function formatCountdownMmSs(remainingSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number(remainingSeconds) || 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const ARABIC_WEEKDAYS = [
  'الأحد',
  'الإثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
];

const ENGLISH_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface FormattedMobileSyncTimestamp {
  dateStr: string;
  weekdayStr: string;
  timeStr: string;
  periodStr: string;
  fullText: string;
}

export function formatMobileSyncTimestamp(iso?: string | null): FormattedMobileSyncTimestamp | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const isEn = getActiveLanguage() === 'en';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const weekdayStr = (isEn ? ENGLISH_WEEKDAYS : ARABIC_WEEKDAYS)[d.getDay()] || '';
  const hours24 = d.getHours();
  const periodStr = isEn ? (hours24 < 12 ? 'AM' : 'PM') : (hours24 < 12 ? 'ص' : 'م');
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const mins = String(d.getMinutes()).padStart(2, '0');
  const dateStr = `${dd}-${mm}-${yyyy}`;
  const timeStr = `${String(hours12).padStart(2, '0')}:${mins}`;
  return {
    dateStr,
    weekdayStr,
    timeStr,
    periodStr,
    fullText: `${dateStr} ${weekdayStr} ${timeStr} ${periodStr}`,
  };
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

function syncMetaKey(
  base: 'last_send_summary' | 'last_receive_summary' | 'last_sync_at' | 'server_sync_state',
  userId?: string
): string {
  const uid = String(userId || '').trim();
  return uid ? `${base}:${uid}` : base;
}

export const EMPTY_USER_SYNC_STATE: ServerUserSyncState = {
  lastSendAt: null,
  lastSendStatus: 'never',
  lastSendCount: 0,
  lastSendSummary: {},
  lastReceiveAt: null,
  lastReceiveStatus: 'never',
  lastReceiveCount: 0,
  lastReceiveSummary: {},
};

export async function getStoredUserSyncState(userId?: string): Promise<ServerUserSyncState> {
  if (!userId) return { ...EMPTY_USER_SYNC_STATE };
  const stored = await localDb.getMeta<ServerUserSyncState>(syncMetaKey('server_sync_state', userId));
  return stored ? { ...EMPTY_USER_SYNC_STATE, ...stored } : { ...EMPTY_USER_SYNC_STATE };
}

export async function saveStoredUserSyncState(userId: string, state: ServerUserSyncState): Promise<void> {
  if (!userId) return;
  await localDb.setMeta<ServerUserSyncState>(syncMetaKey('server_sync_state', userId), {
    ...EMPTY_USER_SYNC_STATE,
    ...state,
  });
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

async function recordSyncRefreshSummary(
  base: 'last_send_summary' | 'last_receive_summary',
  userId: string,
  next: {
    at: string;
    count: number;
    failedCount?: number;
    conflictCount?: number;
    ok: boolean;
    isMandatory?: boolean;
    error?: string;
  }
): Promise<void> {
  const key = syncMetaKey(base, userId);
  const prev = await localDb.getMeta<SyncRefreshSummary>(key);
  if (next.ok) {
    await localDb.setMeta<SyncRefreshSummary>(key, {
      at: next.at,
      lastAttemptAt: next.at,
      count: next.count,
      failedCount: next.failedCount,
      conflictCount: next.conflictCount,
      ok: true,
      isMandatory: next.isMandatory,
    });
    return;
  }
  const preservedSuccessAt = prev?.at ? prev.at : '';
  const preservedSuccessCount = prev?.at ? prev.count : 0;
  await localDb.setMeta<SyncRefreshSummary>(key, {
    at: preservedSuccessAt,
    lastAttemptAt: next.at,
    count: preservedSuccessCount,
    failedCount: next.failedCount,
    conflictCount: next.conflictCount,
    ok: false,
    isMandatory: next.isMandatory,
    error: next.error,
  });
}

async function executeSyncCycle(params: {
  userId: string;
  forceAll?: boolean;
  mode?: SyncCycleMode;
  includeHeldBatches?: boolean;
  isMandatory?: boolean;
  silent?: boolean;
  onProgress?: (progress: SyncProgressUpdate) => void;
}): Promise<SyncCycleOutcome> {
  const {
    userId,
    forceAll = false,
    mode = 'full',
    includeHeldBatches = false,
    isMandatory = false,
    silent = false,
    onProgress,
  } = params;
  const nowMs = Date.now();
  const queue = await localDb.listSyncQueue(userId);
  const report = (percent: number, stage: string, completed?: number, total?: number) => {
    try {
      onProgress?.({ percent: Math.max(0, Math.min(100, Math.round(percent))), stage, completed, total });
    } catch {
      // ignore listener errors
    }
  };

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
      report(
        15,
        tr(`جاري تجهيز ${orderedOps.length} عملية للإرسال...`, `Preparing ${orderedOps.length} operations to send...`),
        0,
        orderedOps.length
      );

      try {
        const chunkSize = 50;
        const resultMap = new Map<
          string,
          {
            operationId: string;
            status: 'synced' | 'failed' | 'needs_review';
            error?: string;
            conflict?: SyncConflictRecord;
            conflictId?: string;
          }
        >();

        for (let offset = 0; offset < orderedOps.length; offset += chunkSize) {
          const chunk = orderedOps.slice(offset, offset + chunkSize);
          const pctStart = 20 + Math.round((offset / orderedOps.length) * 60);
          report(
            pctStart,
            tr(
              `جاري إرسال العمليات (${Math.min(offset + chunk.length, orderedOps.length)} / ${orderedOps.length})...`,
              `Sending operations (${Math.min(offset + chunk.length, orderedOps.length)} / ${orderedOps.length})...`
            ),
            offset,
            orderedOps.length
          );
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
            body: { operations: chunk },
          });

          for (const r of Array.isArray(pushRes?.results) ? pushRes.results : []) {
            resultMap.set(r.operationId, r);
          }
        }

        report(85, tr('جاري تأكيد الاستلام وتحديث السجل المحلي...', 'Confirming receipt and updating local log...'), orderedOps.length, orderedOps.length);

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
              holdForDispatchBatch: false,
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
              lastError: res.error || res.conflict?.conflictReason || tr('تعارض يحتاج مراجعة يدوية', 'Conflict requires manual review'),
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
              lastError: res.error || tr('تعذر تنفيذ العملية على السيرفر', 'Could not execute operation on the server'),
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

        if (!silent) {
          await recordSyncRefreshSummary('last_send_summary', userId, {
            at: updateTimestamp,
            count: syncedCount,
            failedCount,
            conflictCount,
            ok: failedCount === 0 && conflictCount === 0 && syncedCount > 0,
            isMandatory,
            error: failedCount > 0 ? tr('تعذر إرسال بعض العمليات وبقيت محفوظة لإعادة المحاولة.', 'Some operations could not be sent and were kept for retry.') : undefined,
          });
        }
        report(100, tr('اكتمل الإرسال', 'Sending completed'), orderedOps.length, orderedOps.length);
        if (failedCount > 0 || newConflicts.length > 0) {
          logDiagnostic({
            category: 'sync_issue',
            severity: failedCount > 0 ? 'error' : 'warning',
            source: 'syncEngine.push',
            message:
              failedCount > 0
                ? tr(`فشل إرسال (${failedCount}) عملية من طابور المزامنة وبقيت محفوظة لإعادة المحاولة`, `Failed to send (${failedCount}) sync queue operation(s); kept for retry`)
                : tr(`تم رصد (${newConflicts.length}) تعارض مزامنة يحتاج مراجعة`, `Detected (${newConflicts.length}) sync conflict(s) needing review`),
            details: { pushedCount, syncedCount, failedCount, conflictCount, mode, isMandatory },
          });
        }
      } catch (err: any) {
        const errMsg = err?.message ? tr(err.message) : tr('تعذر مزامنة العمليات مع قاعدة البيانات المركزية', 'Could not sync operations with the central database');
        logDiagnostic({
          category: isAuthRevokedError(err) ? 'auth' : 'sync_issue',
          severity: 'error',
          source: 'syncEngine.push',
          message: errMsg,
          details: { status: err?.status, code: err?.code, pendingCount: dueOperations.length, mode, isMandatory },
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
        await recordSyncRefreshSummary('last_send_summary', userId, {
          at: new Date().toISOString(),
          count: 0,
          failedCount: dueOperations.length,
          conflictCount,
          ok: false,
          isMandatory,
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
            error: err?.message ? tr(err.message) : tr('الاتصال غير متاح حالياً — تم الاحتفاظ بالعمليات محلياً', 'Connection is currently unavailable — operations kept locally'),
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
      // Explicit send with 0 pending ops still verifies reachability cleanly
      report(35, tr('جاري التحقق من عدم وجود عمليات معلقة...', 'Checking for any pending operations...'));
      try {
        await apiRequest('/api/sync/push', {
          method: 'POST',
          body: { operations: [] },
        });
        await recordSyncRefreshSummary('last_send_summary', userId, {
          at: new Date().toISOString(),
          count: 0,
          failedCount: 0,
          conflictCount,
          ok: true,
          isMandatory,
        });
        report(100, tr('اكتمل الإرسال', 'Sending completed'));
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
          error: err?.message ? tr(err.message) : tr('تعذر الاتصال بالنظام المركزي', 'Unable to connect to the central system'),
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
    if (mode === 'receive_only') {
      report(20, tr('جاري جلب التحديثات والفواتير والأرصدة...', 'Fetching updates, invoices, and balances...'));
    }
    const pullData = await apiRequest<any>('/api/sync/pull');
    const nowTime = pullData?.serverTime || new Date().toISOString();
    if (mode === 'receive_only') {
      report(70, tr('جاري تحديث قاعدة البيانات المحلية دون تكرار...', 'Updating local database without duplicates...'));
    }
    await localDb.setMeta(syncMetaKey('last_sync_at', userId), nowTime);

    const serverConflicts: SyncConflictRecord[] = Array.isArray(pullData?.syncConflicts)
      ? pullData.syncConflicts
      : [];
    await localDb.saveConflicts(userId, serverConflicts);

    const unresolvedConflicts = serverConflicts.filter((c) => c.status === 'needs_review').length;
    const receivedCount =
      (Array.isArray(pullData?.products) ? pullData.products.length : 0) +
      (Array.isArray(pullData?.customers) ? pullData.customers.length : 0) +
      (Array.isArray(pullData?.invoices) ? pullData.invoices.length : 0) +
      (Array.isArray(pullData?.repItemTransfers) ? pullData.repItemTransfers.length : 0) +
      (Array.isArray(pullData?.repTransfers) ? pullData.repTransfers.length : 0) +
      (Array.isArray(pullData?.repCustodyOperations) ? pullData.repCustodyOperations.length : 0) +
      (Array.isArray(pullData?.syncDispatchBatches) ? pullData.syncDispatchBatches.length : 0) +
      (Array.isArray(pullData?.customerItemOrders) ? pullData.customerItemOrders.length : 0);

    if (pullData?.syncState) {
      await saveStoredUserSyncState(userId, pullData.syncState);
    }

    if (!silent) {
      await recordSyncRefreshSummary('last_receive_summary', userId, {
        at: nowTime,
        count: receivedCount,
        ok: true,
      });
    }
    if (mode === 'receive_only' && !silent) {
      report(100, tr(`تم استلام وتحديث ${receivedCount} سجل`, `Received and updated ${receivedCount} record(s)`), receivedCount, receivedCount);
    }

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
    const pullErr = err?.message ? tr(err.message) : tr('تعذر استلام أحدث البيانات', 'Failed to receive latest data');
    logDiagnostic({
      category: isAuthRevokedError(err) ? 'auth' : 'sync_issue',
      severity: 'error',
      source: 'syncEngine.pull',
      message: pullErr,
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
    await recordSyncRefreshSummary('last_receive_summary', userId, {
      at: new Date().toISOString(),
      count: 0,
      ok: false,
      error: pullErr,
    });
    return {
      ok: false,
      serverReachable: !isUnreachableError(err),
      mode,
      pushedCount,
      syncedCount,
      failedCount,
      conflictCount,
      error: pullErr,
    };
  }
}

export function runSyncCycle(params: {
  userId: string;
  forceAll?: boolean;
  mode?: SyncCycleMode;
  includeHeldBatches?: boolean;
  isMandatory?: boolean;
  silent?: boolean;
  onProgress?: (progress: SyncProgressUpdate) => void;
}): Promise<SyncCycleOutcome> {
  const lockKey = `${params.userId}:${params.mode || 'full'}:${params.silent ? 'silent' : 'active'}`;
  const existing = activeLocks.get(lockKey);
  if (existing) return existing;

  const job = executeSyncCycle(params).finally(() => {
    activeLocks.delete(lockKey);
  });
  activeLocks.set(lockKey, job);
  return job;
}

export async function executeManualSendSync(params: {
  userId: string;
  operationIds?: string[];
  onProgress?: (progress: SyncProgressUpdate) => void;
}): Promise<{
  ok: boolean;
  serverReachable: boolean;
  authRevoked?: boolean;
  revokeReason?: string;
  sentCount: number;
  deduplicatedCount: number;
  failedCount: number;
  conflictCount: number;
  sentAt: string | null;
  summary: Record<string, number>;
  syncState: ServerUserSyncState | null;
  error?: string;
}> {
  const { userId, operationIds, onProgress } = params;
  const queue = await localDb.listSyncQueue(userId);
  const selectedSet = operationIds && operationIds.length > 0 ? new Set(operationIds) : null;
  const targetOps = queue
    .filter((item) => {
      if (item.status === 'synced') return false;
      if (selectedSet && !selectedSet.has(item.operationId)) return false;
      return true;
    })
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  if (targetOps.length === 0) {
    const syncState = await fetchUserSyncStateApi()
      .then((r) => r.state)
      .catch(() => getStoredUserSyncState(userId));
    if (syncState) await saveStoredUserSyncState(userId, syncState);
    return {
      ok: true,
      serverReachable: true,
      sentCount: 0,
      deduplicatedCount: 0,
      failedCount: 0,
      conflictCount: 0,
      sentAt: syncState?.lastSendAt || null,
      summary: {},
      syncState,
    };
  }

  onProgress?.({
    percent: 20,
    stage: tr(`جاري إرسال ${targetOps.length} عملية...`, `Sending ${targetOps.length} operation(s)...`),
    completed: 0,
    total: targetOps.length,
  });

  try {
    const chunkSize = 100;
    const allResults: ServerSendSyncResponse['results'] = [];
    let latestRes: ServerSendSyncResponse | null = null;

    for (let offset = 0; offset < targetOps.length; offset += chunkSize) {
      const chunk = targetOps.slice(offset, offset + chunkSize);
      const pct = 25 + Math.round((offset / targetOps.length) * 55);
      onProgress?.({
        percent: pct,
        stage: tr(
          `جاري إرسال (${Math.min(offset + chunk.length, targetOps.length)} / ${targetOps.length})...`,
          `Sending (${Math.min(offset + chunk.length, targetOps.length)} / ${targetOps.length})...`
        ),
        completed: offset,
        total: targetOps.length,
      });
      const res = await sendManualSyncApi(chunk);
      latestRes = res;
      if (Array.isArray(res.results)) {
        allResults.push(...res.results);
      }
    }

    const resultMap = new Map(allResults.map((r) => [r.operationId, r]));
    const nowIso = new Date().toISOString();
    const newConflicts: SyncConflictRecord[] = [];
    const updatedQueue = queue.map((item) => {
      const r = resultMap.get(item.operationId);
      if (!r) return item;
      if (r.status === 'synced') {
        return {
          ...item,
          status: 'synced' as const,
          holdForDispatchBatch: false,
          lastError: undefined,
          nextRetryAt: undefined,
          updatedAt: nowIso,
        };
      }
      if (r.status === 'needs_review') {
        if (r.conflict) newConflicts.push(r.conflict);
        return {
          ...item,
          status: 'needs_review' as const,
          attempts: (item.attempts || 0) + 1,
          conflictId: r.conflictId || r.conflict?.id || item.conflictId,
          lastError: r.error || r.conflict?.conflictReason || tr('تعارض يحتاج مراجعة', 'Conflict requires review'),
          nextRetryAt: undefined,
          updatedAt: nowIso,
        };
      }
      return {
        ...item,
        status: 'failed' as const,
        attempts: (item.attempts || 0) + 1,
        lastError: r.error || tr('تعذر تنفيذ العملية على السيرفر', 'Could not execute operation on server'),
        nextRetryAt: Date.now() + 15000,
        updatedAt: nowIso,
      };
    });

    await localDb.saveSyncQueue(userId, updatedQueue);
    if (newConflicts.length > 0) {
      const existingConflicts = await localDb.listConflicts(userId);
      const merged = [...newConflicts];
      for (const oldCf of existingConflicts) {
        if (!merged.some((c) => c.id === oldCf.id)) merged.push(oldCf);
      }
      await localDb.saveConflicts(userId, merged);
    }

    const syncedResults = allResults.filter((r) => r.status === 'synced');
    const deduplicatedCount = syncedResults.filter((r) => r.deduplicated).length;
    const failedCount = allResults.filter((r) => r.status === 'failed').length;
    const conflictCount = allResults.filter((r) => r.status === 'needs_review').length;
    const allSucceeded = failedCount === 0 && conflictCount === 0;

    if (latestRes?.syncState) {
      await saveStoredUserSyncState(userId, latestRes.syncState);
    }
    if (allSucceeded && syncedResults.length > 0) {
      await recordSyncRefreshSummary('last_send_summary', userId, {
        at: latestRes?.sentAt || latestRes?.syncState?.lastSendAt || nowIso,
        count: syncedResults.length,
        failedCount: 0,
        conflictCount: 0,
        ok: true,
      });
    } else if (failedCount > 0 || conflictCount > 0) {
      await recordSyncRefreshSummary('last_send_summary', userId, {
        at: nowIso,
        count: 0,
        failedCount,
        conflictCount,
        ok: false,
        error: tr('تعذر إرسال بعض العمليات وبقيت محفوظة لإعادة المحاولة.', 'Some operations could not be sent and were kept for retry.'),
      });
    }

    onProgress?.({ percent: 100, stage: tr('اكتمل الإرسال', 'Sending completed'), completed: targetOps.length, total: targetOps.length });

    return {
      ok: allSucceeded,
      serverReachable: true,
      sentCount: syncedResults.length,
      deduplicatedCount,
      failedCount,
      conflictCount,
      sentAt: latestRes?.sentAt || latestRes?.syncState?.lastSendAt || null,
      summary: latestRes?.summary || {},
      syncState: latestRes?.syncState || null,
      error: !allSucceeded
        ? tr('فشل إرسال بعض العمليات وبقيت محفوظة في الطابور لإعادة المحاولة.', 'Some operations failed to send and remain queued for retry.')
        : undefined,
    };
  } catch (err: any) {
    if (isAuthRevokedError(err)) {
      return {
        ok: false,
        serverReachable: true,
        authRevoked: true,
        revokeReason: err?.message,
        sentCount: 0,
        deduplicatedCount: 0,
        failedCount: targetOps.length,
        conflictCount: 0,
        sentAt: null,
        summary: {},
        syncState: null,
        error: err?.message,
      };
    }
    const errMsg = err?.message
      ? tr(err.message)
      : tr('تعذر الاتصال بالنظام المركزي — بقيت العمليات محفوظة للإرسال لاحقاً', 'Unable to connect — operations preserved locally for retry');
    return {
      ok: false,
      serverReachable: !isUnreachableError(err),
      sentCount: 0,
      deduplicatedCount: 0,
      failedCount: targetOps.length,
      conflictCount: 0,
      sentAt: null,
      summary: {},
      syncState: null,
      error: errMsg,
    };
  }
}

export async function executeManualReceiveConfirm(params: {
  userId: string;
  idempotencyKey?: string;
  confirmCustodyIds?: string[];
  confirmCashTransferIds?: string[];
  confirmBatchIds?: string[];
  onProgress?: (progress: SyncProgressUpdate) => void;
}): Promise<{
  ok: boolean;
  serverReachable: boolean;
  authRevoked?: boolean;
  revokeReason?: string;
  response: ReceiveConfirmResponse | null;
  error?: string;
}> {
  const { userId, onProgress, ...body } = params;
  onProgress?.({ percent: 25, stage: tr('جاري تأكيد الاستلام وتحديث البيانات...', 'Confirming receipt and updating data...') });
  try {
    const res = await confirmManualReceiveApi(body);
    if (res.syncState) {
      await saveStoredUserSyncState(userId, res.syncState);
    }
    if (res.allSucceeded) {
      await recordSyncRefreshSummary('last_receive_summary', userId, {
        at: res.receivedAt || res.syncState?.lastReceiveAt || new Date().toISOString(),
        count: res.receivedCount,
        ok: true,
      });
    }
    onProgress?.({ percent: 100, stage: tr('تم تأكيد الاستلام', 'Receipt confirmed') });
    return {
      ok: res.allSucceeded,
      serverReachable: true,
      response: res,
      error: res.allSucceeded
        ? undefined
        : (res.errors || []).map((e) => e.error).join(' · ') || tr('تعذر تأكيد استلام بعض العناصر', 'Could not confirm some items'),
    };
  } catch (err: any) {
    if (isAuthRevokedError(err)) {
      return {
        ok: false,
        serverReachable: true,
        authRevoked: true,
        revokeReason: err?.message,
        response: null,
        error: err?.message,
      };
    }
    return {
      ok: false,
      serverReachable: !isUnreachableError(err),
      response: null,
      error: err?.message ? tr(err.message) : tr('تعذر إتمام الاستلام حالياً', 'Could not complete receive right now'),
    };
  }
}

export { fetchReceivePreviewApi };

export async function sendDispatchBatchToServer(params: {
  userId: string;
  senderName: string;
  representativeId?: string;
  representativeName?: string;
  selectedOperations: SyncQueueItem[];
  recipient: DispatchRecipientOption;
  notes?: string;
  existingDraftBatch?: SyncDispatchBatch;
  onProgress?: (progress: SyncProgressUpdate) => void;
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
    onProgress,
  } = params;
  onProgress?.({
    percent: 15,
    stage: tr(`جاري تجهيز ${selectedOperations.length} عملية للإرسال...`, `Preparing ${selectedOperations.length} operations to send...`),
  });
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
      op.operationType === 'record_order_advance' ||
      op.operationType === 'create_rep_transfer' ||
      op.operationType === 'confirm_rep_transfer'
    ) {
      collectionsCount += 1;
      totalCashAmount += Number(p.amount || 0);
    } else if (op.operationType.includes('return')) {
      returnsCount += 1;
    } else if (op.operationType === 'create_order') {
      ordersCount += 1;
    } else if (op.operationType === 'create_customer' || op.operationType === 'update_customer') {
      customersCount += 1;
    } else if (
      op.operationType.includes('custody') ||
      op.operationType === 'create_rep_item_transfer' ||
      op.operationType === 'transfer_stock' ||
      op.operationType === 'record_damaged_stock'
    ) {
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
    const queuedMsg = tr('طلب الإرسال مؤكد من المرسل — في انتظار المزامنة التلقائية فور عودة الاتصال.', 'Send request confirmed by sender — awaiting automatic sync once connection resumes.');
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
  onProgress?.({ percent: 45, stage: tr('جاري إرسال العمليات...', 'Sending operations...') });

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
    onProgress?.({ percent: 85, stage: tr('جاري تأكيد الوصول وتحديث السجل المحلي...', 'Confirming delivery and updating local log...') });

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
          lastError: r.error || tr('تعارض يحتاج مراجعة', 'Conflict requires review'),
          dispatchStage: 'تعذر الاستلام' as SyncDispatchBatchStatus,
          updatedAt: new Date().toISOString(),
        };
      }
      return {
        ...q,
        status: 'failed' as const,
        attempts: (q.attempts || 0) + 1,
        lastError: r.error || tr('تعذر تنفيذ العملية ضمن الدفعة', 'Could not execute operation in the batch'),
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

    await recordSyncRefreshSummary('last_send_summary', userId, {
      at: new Date().toISOString(),
      count: orderedOps.length,
      failedCount: 0,
      conflictCount: (res.opResults || []).filter((r) => r.status === 'needs_review').length,
      ok: true,
    });
    onProgress?.({ percent: 100, stage: tr('اكتمل الإرسال بنجاح', 'Sent successfully') });

    return { ok: true, batch: serverBatch };
  } catch (err: any) {
    const authRevoked = isAuthRevokedError(err);
    const statusCode = Number(err?.status || 0);
    const isNetworkUnreachable = !authRevoked && (!statusCode || statusCode === 502 || statusCode === 503 || statusCode === 504);

    if (isNetworkUnreachable) {
      const queuedMsg = tr('طلب الإرسال مؤكد من المرسل — في انتظار المزامنة التلقائية فور عودة الاتصال.', 'Send request confirmed by sender — awaiting automatic sync once connection resumes.');
      const queuedDraft = await persistConfirmedOfflineQueue(queuedMsg);
      return {
        ok: false,
        queuedOfflineConfirmed: true,
        batch: queuedDraft,
        error: queuedMsg,
      };
    }

    const errMsg = err?.message
      ? tr(err.message)
      : tr('تعذر إرسال الدفعة — بقيت العمليات محفوظة محليًا ويمكن إعادة الإرسال دون فقد أو تكرار.', 'Could not send batch — operations remained saved locally and can be resent without loss or duplication.');
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

    await recordSyncRefreshSummary('last_send_summary', userId, {
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


import os from 'node:os';
import { Router } from 'express';
import {
  getStaffBootstrapData,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  recordSupplierPayment,
  settleSupplierAdvance,
  createCashbox,
  updateCashbox,
  transferCashbox,
  addExpenseOrIncome,
  executeCashOperation,
  addCheque,
  updateChequeStatus,
  addInstallmentSchedule,
  payInstallment,
  addRepresentative,
  updateRepresentative,
  addEmployee,
  updateEmployee,
  addAdvanceDeduction,
  recordAttendance,
  issuePayroll,
  updateSystemSettings,
  exportFullBackup,
  restoreFullBackup,
} from '../db/stores/inventoryAdminStore.js';
import { listAuditLogs } from '../db/stores/authStore.js';
import { getSystemSettingsSafe } from '../db/stores/catalogStore.js';
import {
  listPairingTokens,
  createPairingToken,
  revokePairingToken,
  listPairedDevices,
  approvePairedDevice,
  revokePairedDevice,
  pushConnectionConfigUpdate,
  updateTunnelRuntimeStatus,
  getTunnelRuntimeStatus,
  resolveSafeConnectionProfiles,
  parseValidAndroidSha256Fingerprints,
} from '../db/stores/connectionPairingStore.js';
import { checkPostgresHealth, initializeSchema, isStrictPostgresMode } from '../db/postgres.js';
import { runDataMigration, rollbackMigration, readMigrationLogs } from '../db/migrator.js';
import { readJsonDatabase, hasJsonDatabaseFile, getDataPaths } from '../db/jsonLedger.js';
import {
  requireAuth,
  requireStaff,
  requireAdmin,
  requirePermission,
  asyncHandler,
} from '../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireStaff);

router.get(
  '/bootstrap',
  asyncHandler(async (req, res) => {
    const data = await getStaffBootstrapData(req.auth.user);
    res.json({ ok: true, data });
  })
);

router.get(
  '/server-info',
  requirePermission('canManageSettings'),
  asyncHandler(async (req, res) => {
    const port = Number(process.env.AWLAD_ACTIVE_PORT || process.env.PORT || process.env.API_PORT || 3000);
    const nets = os.networkInterfaces();
    const lanIps = [];
    const lanUrls = [];
    for (const list of Object.values(nets)) {
      if (!Array.isArray(list)) continue;
      for (const iface of list) {
        if (iface && iface.family === 'IPv4' && !iface.internal) {
          lanIps.push(iface.address);
          lanUrls.push({ ip: iface.address, url: `http://${iface.address}:${port}` });
        }
      }
    }
    const { dataDir } = getDataPaths();
    const pgHealth = await checkPostgresHealth();
    const forwardedProto = String(req.get('x-forwarded-proto') || req.protocol || 'http')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const sys = await getSystemSettingsSafe();
    const connectionConfig = resolveSafeConnectionProfiles(sys, lanUrls, port);
    const { summary: devicesSummary } = await listPairedDevices();
    const androidFingerprints = parseValidAndroidSha256Fingerprints(
      process.env.ANDROID_APP_SHA256_FINGERPRINTS || ''
    );
    const androidAppLinkHost = String(process.env.ANDROID_APP_LINK_HOST || '').trim().toLowerCase();
    const androidAppLinksReady =
      androidFingerprints.length > 0 && Boolean(androidAppLinkHost) && androidAppLinkHost !== 'awladselim.app';
    res.json({
      ok: true,
      hostname: os.hostname(),
      port,
      lanIps,
      lanUrls,
      dataDir,
      isElectron: process.env.AWLAD_ELECTRON === 'true',
      electronDesktop: process.env.AWLAD_ELECTRON === 'true',
      strictMode: isStrictPostgresMode(),
      databaseAvailable: pgHealth.status === 'online',
      databaseMode:
        pgHealth.status === 'online'
          ? 'postgresql-enterprise'
          : isStrictPostgresMode()
          ? 'postgresql-strict-unavailable'
          : 'local-json-ledger',
      postgresStatus: pgHealth.status,
      protocol: forwardedProto,
      httpsActive: forwardedProto === 'https' || Boolean(req.secure),
      trustProxy: process.env.TRUST_PROXY !== 'false',
      tunnelStatus: getTunnelRuntimeStatus(),
      connectionConfig,
      devicesSummary,
      appLinksConfigured: {
        android: androidAppLinksReady,
        ios: Boolean(String(process.env.APPLE_TEAM_ID || '').trim()),
        androidDetails: {
          packageName: (process.env.ANDROID_APP_ID || 'com.awladselim.erp').trim(),
          appLinkHost: androidAppLinkHost && androidAppLinkHost !== 'awladselim.app' ? androidAppLinkHost : null,
          hasValidFingerprints: androidFingerprints.length > 0,
          fingerprintsCount: androidFingerprints.length,
        },
      },
    });
  })
);

// Smart Device Pairing & Connection Management (Permitted Admin / Settings Manager only)
router.get(
  '/pairing/tokens',
  requirePermission('canManageSettings'),
  asyncHandler(async (_req, res) => {
    const tokens = await listPairingTokens();
    res.json({ ok: true, tokens });
  })
);

router.post(
  '/pairing/tokens',
  requirePermission('canManageSettings'),
  asyncHandler(async (req, res) => {
    const created = await createPairingToken(req.body || {}, req.auth.user, req);
    res.status(201).json({ ok: true, ...created });
  })
);

router.post(
  '/pairing/tokens/:id/revoke',
  requirePermission('canManageSettings'),
  asyncHandler(async (req, res) => {
    const result = await revokePairingToken(req.params.id, req.auth.user);
    res.json(result);
  })
);

router.get(
  '/devices',
  requirePermission('canManageSettings'),
  asyncHandler(async (_req, res) => {
    const result = await listPairedDevices();
    res.json({ ok: true, ...result });
  })
);

router.post(
  '/devices/:deviceId/approve',
  requirePermission('canManageSettings'),
  asyncHandler(async (req, res) => {
    const device = await approvePairedDevice(req.params.deviceId, req.auth.user);
    res.json({ ok: true, device });
  })
);

router.post(
  '/devices/:deviceId/revoke',
  requirePermission('canManageSettings'),
  asyncHandler(async (req, res) => {
    const device = await revokePairedDevice(req.params.deviceId, req.auth.user);
    res.json({ ok: true, device });
  })
);

router.post(
  '/devices/:deviceId/resend-link',
  requirePermission('canManageSettings'),
  asyncHandler(async (req, res) => {
    const { devices } = await listPairedDevices();
    const target = devices.find((d) => d.deviceId === req.params.deviceId);
    const created = await createPairingToken(
      {
        ...(req.body || {}),
        targetUserId: req.body?.targetUserId ?? target?.linkedUserId ?? '',
        targetDeviceType:
          req.body?.targetDeviceType ||
          (target?.deviceType && target.deviceType !== 'web' ? target.deviceType : 'any'),
        notes: req.body?.notes || (target ? `إعادة ربط الجهاز: ${target.deviceName}` : ''),
      },
      req.auth.user,
      req
    );
    res.status(201).json({ ok: true, ...created });
  })
);

router.post(
  '/connection/push-update',
  requirePermission('canManageSettings'),
  asyncHandler(async (req, res) => {
    const connectionConfig = await pushConnectionConfigUpdate(req.auth.user);
    res.json({ ok: true, connectionConfig });
  })
);

router.post(
  '/tunnel-status',
  requirePermission('canManageSettings'),
  asyncHandler(async (req, res) => {
    const result = await updateTunnelRuntimeStatus(req.body || {}, req.auth.user);
    res.json({ ok: true, ...result });
  })
);

// Users management
router.post(
  '/users',
  requirePermission('canManageUsers'),
  asyncHandler(async (req, res) => {
    const user = await createAdminUser(req.body || {}, req.auth.user);
    res.status(201).json({ ok: true, user });
  })
);

router.put(
  '/users/:id',
  requirePermission('canManageUsers'),
  asyncHandler(async (req, res) => {
    const user = await updateAdminUser(req.params.id, req.body || {}, req.auth.user);
    res.json({ ok: true, user });
  })
);

router.delete(
  '/users/:id',
  requirePermission('canManageUsers'),
  asyncHandler(async (req, res) => {
    await deleteAdminUser(req.params.id, req.auth.user);
    res.json({ ok: true });
  })
);

router.get(
  '/audit-logs',
  requirePermission('canManageUsers'),
  asyncHandler(async (req, res) => {
    const logs = await listAuditLogs(req.query.limit);
    res.json({ ok: true, logs });
  })
);

// Suppliers
router.post('/suppliers', requirePermission('canManagePurchases'), asyncHandler(async (req, res) => {
  const supplier = await createSupplier(req.body || {}, req.auth.user);
  res.status(201).json({ ok: true, supplier });
}));
router.put('/suppliers/:id', requirePermission('canManagePurchases'), asyncHandler(async (req, res) => {
  await updateSupplier(req.params.id, req.body || {}, req.auth.user);
  res.json({ ok: true });
}));
router.delete('/suppliers/:id', requirePermission('canDelete'), asyncHandler(async (req, res) => {
  await deleteSupplier(req.params.id, req.auth.user);
  res.json({ ok: true });
}));
router.post('/suppliers/payment', requirePermission('canManageAccounts'), asyncHandler(async (req, res) => {
  const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
  const result = await recordSupplierPayment(req.body || {}, req.auth.user, idempotencyKey);
  res.json({ ok: true, ...result });
}));
router.post('/suppliers/:id/settle-advance', requirePermission('canManageAccounts'), asyncHandler(async (req, res) => {
  const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
  const result = await settleSupplierAdvance(
    { ...(req.body || {}), supplierId: req.params.id },
    req.auth.user,
    idempotencyKey
  );
  res.json({ ok: true, ...result });
}));

// Cashboxes & Expenses
router.post('/cashboxes', requirePermission('canManageCashboxes'), asyncHandler(async (req, res) => {
  const cashbox = await createCashbox(req.body || {}, req.auth.user);
  res.status(201).json({ ok: true, cashbox });
}));
router.put('/cashboxes/:id', requirePermission('canManageCashboxes'), asyncHandler(async (req, res) => {
  await updateCashbox(req.params.id, req.body || {}, req.auth.user);
  res.json({ ok: true });
}));
router.post('/cashboxes/transfer', requirePermission('canManageCashboxes'), asyncHandler(async (req, res) => {
  await transferCashbox(req.body || {}, req.auth.user);
  res.json({ ok: true });
}));
router.post('/expenses', asyncHandler(async (req, res) => {
  const u = req.auth.user;
  if (u.role !== 'admin' && !u.permissions?.canManageCashboxes && !u.permissions?.canManageAccounts) {
    return res.status(403).json({ ok: false, code: 'FORBIDDEN_PERMISSION', error: 'ليس لديك صلاحية تسجيل المصروفات أو الإيرادات' });
  }
  const record = await addExpenseOrIncome(req.body || {}, u);
  res.status(201).json({ ok: true, record });
}));
router.post('/cash-operations', asyncHandler(async (req, res) => {
  const u = req.auth.user;
  const isTransfer = req.body?.type === 'cashbox_transfer';
  if (isTransfer) {
    if (u.role !== 'admin' && !u.permissions?.canManageCashboxes) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN_PERMISSION', error: 'ليس لديك صلاحية الترحيل بين الخزائن' });
    }
  } else if (u.role !== 'admin' && !u.permissions?.canManageCashboxes && !u.permissions?.canManageAccounts) {
    return res.status(403).json({ ok: false, code: 'FORBIDDEN_PERMISSION', error: 'ليس لديك صلاحية تنفيذ العمليات النقدية' });
  }
  const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
  const result = await executeCashOperation(req.body || {}, u, idempotencyKey);
  res.status(result.deduplicated ? 200 : 201).json({ ok: true, ...result });
}));

// Cheques & Installments
router.post('/cheques', requirePermission('canManageAccounts'), asyncHandler(async (req, res) => {
  const cheque = await addCheque(req.body || {}, req.auth.user);
  res.status(201).json({ ok: true, cheque });
}));
router.post('/cheques/:id/status', requirePermission('canManageAccounts'), asyncHandler(async (req, res) => {
  await updateChequeStatus(req.params.id, req.body || {}, req.auth.user);
  res.json({ ok: true });
}));
router.post('/installments', requirePermission('canManageAccounts'), asyncHandler(async (req, res) => {
  const schedule = await addInstallmentSchedule(req.body || {}, req.auth.user);
  res.status(201).json({ ok: true, schedule });
}));
router.post('/installments/:id/pay', requirePermission('canManageAccounts'), asyncHandler(async (req, res) => {
  await payInstallment({ ...(req.body || {}), scheduleId: req.params.id }, req.auth.user);
  res.json({ ok: true });
}));

// Representatives
router.post('/representatives', requirePermission('canManageReps'), asyncHandler(async (req, res) => {
  const representative = await addRepresentative(req.body || {}, req.auth.user);
  res.status(201).json({ ok: true, representative });
}));
router.put('/representatives/:id', requirePermission('canManageReps'), asyncHandler(async (req, res) => {
  await updateRepresentative(req.params.id, req.body || {}, req.auth.user);
  res.json({ ok: true });
}));

// Employees & Payroll
router.post('/employees', requirePermission('canManageEmployees'), asyncHandler(async (req, res) => {
  const employee = await addEmployee(req.body || {}, req.auth.user);
  res.status(201).json({ ok: true, employee });
}));
router.put('/employees/:id', requirePermission('canManageEmployees'), asyncHandler(async (req, res) => {
  await updateEmployee(req.params.id, req.body || {}, req.auth.user);
  res.json({ ok: true });
}));
router.post('/advances', requirePermission('canManageSalaries'), asyncHandler(async (req, res) => {
  const item = await addAdvanceDeduction(req.body || {}, req.auth.user);
  res.status(201).json({ ok: true, item });
}));
router.post('/attendance', requirePermission('canManageEmployees'), asyncHandler(async (req, res) => {
  const record = await recordAttendance(req.body || {}, req.auth.user);
  res.status(201).json({ ok: true, record });
}));
router.post('/payrolls', requirePermission('canManageSalaries'), asyncHandler(async (req, res) => {
  const payroll = await issuePayroll(req.body || {}, req.auth.user);
  res.status(201).json({ ok: true, payroll });
}));

// System Settings
router.put('/settings', requirePermission('canManageSettings'), asyncHandler(async (req, res) => {
  const settings = await updateSystemSettings(req.body || {}, req.auth.user);
  res.json({ ok: true, settings });
}));

// Backup Export & Safe Restore (Admin or Settings Manager only)
router.get('/backup/export', requirePermission('canManageSettings'), asyncHandler(async (req, res) => {
  const backup = await exportFullBackup(req.auth.user);
  res.json({ ok: true, backup });
}));
router.post('/backup/restore', requireAdmin, asyncHandler(async (req, res) => {
  const result = await restoreFullBackup(req.body?.backup || req.body, req.auth.user);
  res.json(result);
}));

// Database Diagnostics & Migration (Admin only)
router.get('/db/health', requirePermission('canManageSettings'), asyncHandler(async (_req, res) => {
  const health = await checkPostgresHealth();
  res.json({ ok: true, health });
}));
router.post('/db/init-schema', requireAdmin, asyncHandler(async (_req, res) => {
  const result = await initializeSchema();
  if (!result.success) return res.status(500).json({ ok: false, error: result.error });
  res.json({ ok: true, message: result.message });
}));
router.get('/migration/logs', requirePermission('canManageSettings'), asyncHandler(async (_req, res) => {
  res.json({ ok: true, logs: readMigrationLogs() });
}));
router.post('/migration/run', requireAdmin, asyncHandler(async (req, res) => {
  const pgHealth = await checkPostgresHealth();
  if (pgHealth.status !== 'online') {
    return res.status(400).json({
      ok: false,
      code: 'POSTGRES_NOT_READY',
      error: 'لا يمكن تنفيذ الترحيل قبل إعداد متغيرات PostgreSQL وتشغيل خدمة قاعدة البيانات بنجاح. تم الاحتفاظ بجميع البيانات الحالية دون أي تغيير.',
    });
  }
  if (!req.body?.database && isStrictPostgresMode()) {
    return res.status(400).json({
      ok: false,
      code: 'MIGRATION_SOURCE_REQUIRED',
      error: 'في وضع الإنتاج الصارم (Strict Mode)، يجب تمرير بيانات النسخة الاحتياطية صراحة في الطلب لتنفيذ الترحيل.',
    });
  }
  if (!req.body?.database && !hasJsonDatabaseFile()) {
    return res.status(400).json({
      ok: false,
      code: 'MIGRATION_SOURCE_NOT_FOUND',
      error: 'لا توجد قاعدة بيانات JSON محلية للترحيل.',
    });
  }
  const source = req.body?.database || readJsonDatabase();
  const result = await runDataMigration(source, req.auth.user.fullName, { isTestRun: Boolean(req.body?.isTestRun) });
  if (!result.success) return res.status(500).json({ ok: false, error: result.error, log: result.log });
  res.json({ ok: true, log: result.log });
}));
router.post('/migration/rollback', requireAdmin, asyncHandler(async (req, res) => {
  if (isStrictPostgresMode()) {
    return res.status(403).json({
      ok: false,
      code: 'STRICT_MODE_DESTRUCTIVE_BLOCKED',
      error:
        'يُمنع التراجع إلى JSON أو مسح جداول PostgreSQL في وضع الإنتاج الصارم (Production Strict Mode) لحماية البيانات ومنع انقسامها.',
    });
  }
  const result = await rollbackMigration(req.body?.migrationId || req.body?.backupFile, req.auth.user.fullName);
  if (!result.success) return res.status(400).json({ ok: false, code: result.code, error: result.error });
  res.json({ ok: true, ...result });
}));

export default router;

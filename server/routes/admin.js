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
import { checkPostgresHealth, initializeSchema } from '../db/postgres.js';
import { runDataMigration, rollbackMigration, readMigrationLogs } from '../db/migrator.js';
import { readJsonDatabase, getDataPaths } from '../db/jsonLedger.js';
import {
  listPairingTokens,
  createPairingToken,
  revokePairingToken,
  listPairedDevices,
  approvePairedDevice,
  rejectPairedDevice,
  disconnectPairedDevice,
  revokePairedDevice,
  parseValidAndroidSha256Fingerprints,
  getTunnelRuntimeStatus,
  pushConnectionConfigUpdate,
  testConnectionEndpointReachability,
} from '../db/stores/connectionPairingStore.js';
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
  asyncHandler(async (_req, res) => {
    const port = Number(process.env.AWLAD_ACTIVE_PORT || process.env.PORT || process.env.API_PORT || 3000);
    const nets = os.networkInterfaces();
    const lanUrls = [];
    const lanIps = [];
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
    const packageName = String(process.env.ANDROID_APP_ID || 'com.awladselim.erp').trim();
    const appLinkHost = String(process.env.ANDROID_APP_LINK_HOST || '').trim().toLowerCase();
    const fingerprints = parseValidAndroidSha256Fingerprints(process.env.ANDROID_APP_SHA256_FINGERPRINTS || '');
    const androidConfigured = fingerprints.length > 0 && Boolean(appLinkHost) && appLinkHost !== 'awladselim.app';
    const iosConfigured = Boolean(String(process.env.APPLE_TEAM_ID || '').trim());

    res.json({
      ok: true,
      hostname: os.hostname(),
      port,
      dataDir,
      lanIps,
      lanUrls,
      isElectron: process.env.AWLAD_ELECTRON === 'true',
      electronDesktop: process.env.AWLAD_ELECTRON === 'true',
      tunnelStatus: getTunnelRuntimeStatus(),
      appLinksConfigured: {
        android: androidConfigured,
        ios: iosConfigured,
        androidDetails: {
          packageName,
          appLinkHost: appLinkHost || null,
          fingerprintsCount: fingerprints.length,
        },
      },
    });
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
router.post('/expenses', requirePermission('canManageCashboxes'), asyncHandler(async (req, res) => {
  const record = await addExpenseOrIncome(req.body || {}, req.auth.user);
  res.status(201).json({ ok: true, record });
}));
router.post('/cash-operations', requirePermission('canManageCashboxes'), asyncHandler(async (req, res) => {
  const idempotencyKey = req.get('idempotency-key') || req.body?.idempotencyKey || '';
  const result = await executeCashOperation(req.body || {}, req.auth.user, idempotencyKey);
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
  const source = req.body?.database || readJsonDatabase();
  const result = await runDataMigration(source, req.auth.user.fullName, { isTestRun: Boolean(req.body?.isTestRun) });
  if (!result.success) return res.status(500).json({ ok: false, error: result.error, log: result.log });
  res.json({ ok: true, log: result.log });
}));
router.post('/migration/rollback', requireAdmin, asyncHandler(async (req, res) => {
  const result = await rollbackMigration(req.body?.migrationId || req.body?.backupFile, req.auth.user.fullName);
  if (!result.success) return res.status(400).json({ ok: false, error: result.error });
  res.json({ ok: true, ...result });
}));

// Device Pairing & Connected Devices Administration (Admin Only)
router.get(
  '/pairing/tokens',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const tokens = await listPairingTokens();
    res.json({ ok: true, tokens });
  })
);

router.post(
  '/pairing/tokens',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await createPairingToken(req.body || {}, req.auth.user, req);
    res.status(201).json({ ok: true, ...result });
  })
);

router.post(
  '/pairing/tokens/:id/revoke',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await revokePairingToken(req.params.id, req.auth.user);
    res.json({ ok: true });
  })
);

router.get(
  '/devices',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const out = await listPairedDevices();
    res.json({ ok: true, ...out });
  })
);

router.post(
  '/devices/:id/approve',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const device = await approvePairedDevice(req.params.id, req.auth.user);
    res.json({ ok: true, device });
  })
);

router.post(
  '/devices/:id/reject',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const device = await rejectPairedDevice(req.params.id, req.body?.reason || '', req.auth.user);
    res.json({ ok: true, device });
  })
);

router.post(
  '/devices/:id/disconnect',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const device = await disconnectPairedDevice(req.params.id, req.auth.user);
    res.json({ ok: true, device });
  })
);

router.post(
  '/devices/:id/revoke',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const device = await revokePairedDevice(req.params.id, req.auth.user);
    res.json({ ok: true, device });
  })
);

router.post(
  '/devices/:id/resend-link',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { devices } = await listPairedDevices();
    const dev = devices.find((d) => d.deviceId === req.params.id);
    if (!dev) {
      return res.status(404).json({ ok: false, code: 'DEVICE_NOT_FOUND', error: 'الجهاز غير موجود' });
    }
    const result = await createPairingToken(
      {
        targetUserId: dev.linkedUserId,
        targetDeviceType: ['windows', 'android', 'ios'].includes(dev.deviceType) ? dev.deviceType : 'any',
        connectionMode: req.body?.connectionMode || dev.connectionMode || 'auto',
        serverBaseUrl: req.body?.serverBaseUrl,
        notes: `إعادة إرسال رابط ربط (${dev.deviceName})`,
      },
      req.auth.user,
      req
    );
    res.status(201).json({ ok: true, ...result });
  })
);

router.post(
  '/connection/test-endpoint',
  requirePermission('canManageSettings'),
  asyncHandler(async (req, res) => {
    const result = await testConnectionEndpointReachability(
      req.body?.mode || 'local_network',
      req.body?.url || '',
      req.body?.enforceHttps !== false
    );
    res.json(result);
  })
);

router.post(
  '/connection/broadcast-update',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const connectionConfig = await pushConnectionConfigUpdate(req.auth.user);
    res.json({ ok: true, connectionConfig });
  })
);

export default router;

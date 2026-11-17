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
    for (const list of Object.values(nets)) {
      if (!Array.isArray(list)) continue;
      for (const iface of list) {
        if (iface && iface.family === 'IPv4' && !iface.internal) {
          lanUrls.push({ ip: iface.address, url: `http://${iface.address}:${port}` });
        }
      }
    }
    const { dataDir } = getDataPaths();
    res.json({
      ok: true,
      port,
      dataDir,
      lanUrls,
      isElectron: process.env.AWLAD_ELECTRON === 'true',
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

router.get('/server-info', asyncHandler(async (_req, res) => {
  const { networkInterfaces, hostname } = await import('node:os');
  const { getDataPaths } = await import('../db/jsonLedger.js');
  const nets = networkInterfaces();
  const lanIps = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net && net.family === 'IPv4' && !net.internal) {
        lanIps.push(net.address);
      }
    }
  }
  const activePort = Number(process.env.AWLAD_ACTIVE_PORT || process.env.PORT || process.env.API_PORT || 3000);
  res.json({
    ok: true,
    hostname: hostname(),
    port: activePort,
    lanIps,
    lanUrls: lanIps.map((ip) => `http://${ip}:${activePort}`),
    dataDir: getDataPaths().dataDir,
    electronDesktop: process.env.AWLAD_ELECTRON === 'true',
  });
}));

export default router;

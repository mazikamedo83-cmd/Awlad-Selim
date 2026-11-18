import os from 'node:os';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import customersRoutes from './routes/customers.js';
import productsRoutes from './routes/products.js';
import ordersRoutes from './routes/orders.js';
import invoicesRoutes from './routes/invoices.js';
import inventoryRoutes from './routes/inventory.js';
import adminRoutes from './routes/admin.js';
import personalAccountsRoutes from './routes/personalAccounts.js';
import stockCountsRoutes from './routes/stockCounts.js';
import stockTransfersRoutes from './routes/stockTransfers.js';
import mobileRoutes from './routes/mobile.js';
import syncRoutes from './routes/sync.js';
import { pairingApiRouter, pairingPublicPagesRouter } from './routes/pairing.js';
import { checkPostgresHealth, initializeSchema } from './db/postgres.js';
import { getAuthStatus, bootstrapAdmin } from './db/stores/authStore.js';
import { runCustomerLinkConsistencyMigration } from './db/stores/catalogStore.js';
import { exportFullBackup, restoreFullBackup } from './db/stores/inventoryAdminStore.js';
import { requireAuth, requireAdmin, asyncHandler, errorMiddleware } from './middleware/auth.js';
import { resetPgModeCache, isPgMode } from './db/stores/mode.js';

export async function initializeServerRuntime() {
  resetPgModeCache();
  const health = await checkPostgresHealth();
  if (health.status === 'online') {
    await initializeSchema();
    console.log(`[Database] متصل بقاعدة بيانات PostgreSQL (${health.databaseName || 'awlad_selim'}) بنجاح.`);
  } else if (health.status === 'not_configured') {
    console.log('[Database] لم يتم إعداد متغيرات اتصال PostgreSQL بعد (DATABASE_URL أو PGHOST). يعمل السيرفر بأمان على قاعدة السجلات المحلية المؤمنة دون حذف أو تصفير أي بيانات.');
  } else {
    console.warn(`[Database Warning] تعذر الاتصال بـ PostgreSQL (${health.status}). يعمل السيرفر بأمان على قاعدة السجلات المحلية المؤمنة دون حذف أو تصفير أي بيانات.`);
  }
  await isPgMode();

  // Optional automated initial admin creation ONLY if server env vars are explicitly configured AND zero users exist
  const initUser = process.env.ADMIN_INITIAL_USERNAME;
  const initPass = process.env.ADMIN_INITIAL_PASSWORD;
  if (initUser && initPass) {
    try {
      const status = await getAuthStatus();
      if (status.needsAdminSetup) {
        await bootstrapAdmin({
          fullName: process.env.ADMIN_INITIAL_FULL_NAME || 'المدير العام',
          username: initUser,
          password: initPass,
        });
        console.log(`[Bootstrap] Created initial admin account from environment variables.`);
      }
    } catch (err) {
      console.error('[Bootstrap Warning]:', err.message);
    }
  }

  try {
    await runCustomerLinkConsistencyMigration();
  } catch (err) {
    console.warn('[Migration Warning]: customer link consistency:', err.message);
  }
}

export function createApiApp() {
  const app = express();

  app.set('trust proxy', process.env.TRUST_PROXY === 'false' ? false : 1);

  const allowedOriginsEnv = (process.env.ALLOWED_ORIGINS || '').trim();
  const allowedList = allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const allowMobileLanHttp = process.env.ALLOW_MOBILE_LAN_HTTP !== 'false';
  const capacitorOrigins = new Set([
    'capacitor://localhost',
    'ionic://localhost',
    'https://localhost',
    'http://localhost',
    'http://127.0.0.1',
  ]);

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (
          capacitorOrigins.has(origin) ||
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
        ) {
          return cb(null, true);
        }
        if (!allowedList) return cb(null, true);
        if (allowedList.includes(origin)) return cb(null, true);
        if (
          allowMobileLanHttp &&
          /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)\d{1,3}(\.\d{1,3})?(:\d+)?$/i.test(origin)
        ) {
          return cb(null, true);
        }
        return cb(new Error('Origin not allowed by CORS'));
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Device-Info', 'X-Device-Id'],
      credentials: true,
    })
  );

  app.use(express.json({ limit: '50mb' }));

  app.use('/api', (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (process.env.NODE_ENV === 'test' || process.env.AWLAD_QUIET_LOGS === 'true') return;
      if (req.path === '/health') return;
      const ms = Date.now() - start;
      console.log(`[API] ${req.method} ${req.originalUrl.split('?')[0]} -> ${res.statusCode} (${ms}ms)`);
    });
    next();
  });

  // Safe public health check (NEVER leaks credentials, users, or database contents)
  app.get(
    '/api/health',
    asyncHandler(async (_req, res) => {
      const pgStatus = await checkPostgresHealth();
      const authStatus = await getAuthStatus();
      const port = Number(process.env.AWLAD_ACTIVE_PORT || process.env.PORT || process.env.API_PORT || 3000);
      const ifaces = os.networkInterfaces();
      const lanIps = [];
      for (const list of Object.values(ifaces)) {
        if (!Array.isArray(list)) continue;
        for (const iface of list) {
          if (iface && iface.family === 'IPv4' && !iface.internal) {
            lanIps.push(iface.address);
          }
        }
      }
      res.json({
        ok: true,
        service: 'AWLAD SELIM Enterprise Server',
        version: '3.0.0',
        timestamp: new Date().toISOString(),
        mode: pgStatus.status === 'online' ? 'postgresql-enterprise' : 'local-json-ledger',
        needsAdminSetup: authStatus.needsAdminSetup,
        port,
        lanUrls: lanIps.map((ip) => `http://${ip}:${port}`),
        postgres: {
          configured: pgStatus.configured,
          status: pgStatus.status,
          latencyMs: pgStatus.latencyMs,
          message:
            pgStatus.status === 'online'
              ? 'PostgreSQL متصل ويعمل'
              : pgStatus.status === 'not_configured'
              ? 'لم يتم إعداد متغيرات اتصال PostgreSQL بعد. يعمل السيرفر بقاعدة السجلات المحلية المؤمنة دون حذف أو تصفير أي بيانات.'
              : 'تعذر الاتصال بـ PostgreSQL حاليًا. يعمل السيرفر بقاعدة السجلات المحلية المؤمنة دون حذف أو تصفير أي بيانات.',
        },
      });
    })
  );

  // Scoped Modular REST APIs
  app.use('/api/auth', authRoutes);
  app.use('/api/customers', customersRoutes);
  app.use('/api/products', productsRoutes);
  app.use('/api/orders', ordersRoutes);
  app.use('/api/invoices', invoicesRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/personal-accounts', personalAccountsRoutes);
  app.use('/api/stock-counts', stockCountsRoutes);
  app.use('/api/stock-transfers', stockTransfersRoutes);
  app.use('/api/mobile', mobileRoutes);
  app.use('/api/sync', syncRoutes);
  app.use('/api', pairingApiRouter);

  // Legacy full-database endpoints strictly locked to Admin only (401 unauth, 403 non-admin)
  app.get(
    '/api/database',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const database = await exportFullBackup(req.auth.user);
      res.json({ ok: true, database });
    })
  );

  app.put(
    '/api/database',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req, res) => {
      const result = await restoreFullBackup(req.body?.database, req.auth.user);
      res.json(result);
    })
  );

  // Lock down legacy DB/migration URLs behind admin auth as well
  app.get('/api/db/health', requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
    res.json({ ok: true, health: await checkPostgresHealth() });
  }));
  app.post('/api/db/init-schema', requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
    const r = await initializeSchema();
    if (!r.success) return res.status(500).json({ ok: false, error: r.error });
    res.json({ ok: true, message: r.message });
  }));

  // 404 handler for unknown /api/* paths
  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'نقطة الاتصال غير موجودة' });
  });

  // Public invite landing pages (/pair/:token, /invite/:token) & .well-known App Links
  app.use('/', pairingPublicPagesRouter);

  app.use(errorMiddleware);
  return app;
}

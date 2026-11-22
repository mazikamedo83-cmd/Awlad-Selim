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
import reportsRoutes from './routes/reports.js';
import { pairingApiRouter, pairingPublicPagesRouter } from './routes/pairing.js';
import { getTunnelRuntimeStatus } from './db/stores/connectionPairingStore.js';
import { getSystemSettingsSafe } from './db/stores/catalogStore.js';
import {
  checkPostgresHealth,
  initializeSchema,
  isPgConnectionError,
  isStrictPostgresMode,
  sanitizePgErrorMessage,
} from './db/postgres.js';
import { getAuthStatus, bootstrapAdmin } from './db/stores/authStore.js';
import { exportFullBackup, restoreFullBackup } from './db/stores/inventoryAdminStore.js';
import { requireAuth, requireAdmin, asyncHandler, errorMiddleware } from './middleware/auth.js';
import { AppError } from './utils/errors.js';
import {
  resetPgModeCache,
  isPgMode,
  ensureStrictPgReady,
  markPgAvailable,
  markPgUnavailable,
  DATABASE_UNAVAILABLE_CODE,
  DATABASE_UNAVAILABLE_MESSAGE,
} from './db/stores/mode.js';

export async function initializeServerRuntime() {
  resetPgModeCache();
  const strict = isStrictPostgresMode();
  const health = await checkPostgresHealth();

  if (strict) {
    if (health.status !== 'online') {
      const reasonDetail =
        health.status === 'not_configured'
          ? 'متغيرات اتصال PostgreSQL (DATABASE_URL أو PGHOST) غير مضبوطة.'
          : `تعذر الاتصال بقاعدة بيانات PostgreSQL (${health.status}): ${sanitizePgErrorMessage(health.error || health.message)}`;
      throw new Error(
        `[Production Strict Mode] تم رفض تشغيل السيرفر المركزي لأن PostgreSQL غير متاحة: ${reasonDetail} يُمنع الرجوع إلى JSON Ledger لحماية البيانات ومنع انقسامها.`
      );
    }

    const schemaRes = await initializeSchema();
    if (!schemaRes?.success) {
      throw new Error(
        `[Production Strict Mode] فشل تهيئة/التحقق من جداول PostgreSQL: ${sanitizePgErrorMessage(schemaRes?.error || 'unknown_error')}`
      );
    }

    markPgAvailable({ schemaReady: true });
    console.log(
      `[Database] Production Strict Mode مفعّل — متصل حصريًا بـ PostgreSQL (${health.databaseName || 'awlad_selim'}) دون أي رجوع إلى JSON.`
    );
  } else {
    if (health.status === 'online') {
      await initializeSchema();
      console.log(`[Database] متصل بقاعدة بيانات PostgreSQL (${health.databaseName || 'awlad_selim'}) بنجاح.`);
    } else if (health.status === 'not_configured') {
      console.log('[Database] لم يتم إعداد متغيرات اتصال PostgreSQL بعد (DATABASE_URL أو PGHOST). يعمل السيرفر بأمان على قاعدة السجلات المحلية المؤمنة دون حذف أو تصفير أي بيانات.');
    } else {
      console.warn(`[Database Warning] تعذر الاتصال بـ PostgreSQL (${health.status}). يعمل السيرفر بأمان على قاعدة السجلات المحلية المؤمنة دون حذف أو تصفير أي بيانات.`);
    }
    await isPgMode();
  }

  // Optional automated initial admin creation ONLY in non-packaged server setups when explicitly configured AND zero users exist
  const isPackagedElectron = process.env.AWLAD_ELECTRON === 'true' && process.env.AWLAD_IS_PACKAGED === 'true';
  const initUser = process.env.ADMIN_INITIAL_USERNAME;
  const initPass = process.env.ADMIN_INITIAL_PASSWORD;
  if (!isPackagedElectron && initUser && initPass) {
    try {
      const status = await getAuthStatus();
      if (status.needsAdminSetup) {
        await bootstrapAdmin({
          fullName: process.env.ADMIN_INITIAL_FULL_NAME || 'المدير العام',
          username: initUser,
          password: initPass,
          bootstrapSecret: process.env.BOOTSTRAP_ADMIN_SECRET || '',
        });
        console.log(`[Bootstrap] Created initial admin account from environment variables.`);
      }
    } catch (err) {
      if (strict && (isPgConnectionError(err) || err?.code === DATABASE_UNAVAILABLE_CODE)) {
        throw new Error(
          `[Production Strict Mode] فشل التحقق من حساب المدير الأولي بسبب انقطاع PostgreSQL: ${sanitizePgErrorMessage(err?.message)}`
        );
      }
      console.error('[Bootstrap Warning]:', sanitizePgErrorMessage(err?.message));
    }
  }
}

function resolveTrustProxySetting() {
  const raw = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
  if (raw === 'true') return 1;
  if (/^\d+$/.test(raw)) {
    const hops = Number.parseInt(raw, 10);
    return hops > 0 ? hops : false;
  }
  return false;
}

function isDirectLoopbackSocket(req) {
  const addr = String(req.socket?.remoteAddress || '');
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function isPrivateLanSocket(req) {
  const raw = String(req.socket?.remoteAddress || '').trim().toLowerCase();
  const addr = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(addr)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(addr)) return true;
  const m172 = addr.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (addr.startsWith('fc') || addr.startsWith('fd') || addr.startsWith('fe80:')) return true;
  return false;
}

function isRequestHttps(req) {
  if (req.secure) return true;
  if (req.app?.get('trust proxy')) {
    const xfProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
    return xfProto === 'https';
  }
  return false;
}

export function createApiApp() {
  const app = express();

  app.set('trust proxy', resolveTrustProxySetting());

  const capacitorOrigins = new Set([
    'capacitor://localhost',
    'ionic://localhost',
    'https://localhost',
    'http://localhost',
    'http://127.0.0.1',
  ]);

  const matchesOriginPattern = (origin, pattern) => {
    if (origin === pattern) return true;
    if (pattern.startsWith('*.')) {
      try {
        const parsed = new URL(origin);
        const suffix = pattern.slice(1).toLowerCase(); // ".example.com"
        return parsed.hostname.toLowerCase().endsWith(suffix);
      } catch {
        return false;
      }
    }
    return false;
  };

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (isRequestHttps(req)) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // Enforce HTTPS for external/proxied production traffic; permit only direct loopback or explicit private LAN sockets
  app.use((req, res, next) => {
    const isProd = process.env.NODE_ENV === 'production';
    if (!isProd) {
      return next();
    }
    const xfProtoHeader = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
    const proxiedHttp = Boolean(req.app?.get('trust proxy') && xfProtoHeader && xfProtoHeader !== 'https');
    const allowLanHttp = process.env.ALLOW_MOBILE_LAN_HTTP === 'true';
    if (
      !proxiedHttp &&
      (isRequestHttps(req) ||
        isDirectLoopbackSocket(req) ||
        (allowLanHttp && isPrivateLanSocket(req)))
    ) {
      return next();
    }
    return res.status(403).json({
      ok: false,
      code: 'HTTPS_REQUIRED',
      error: 'الاتصال غير المشفر عبر HTTP غير مسموح به خارج الشبكة المحلية في بيئة الإنتاج. يرجى استخدام HTTPS.',
    });
  });

  app.use(
    cors((req, cb) => {
      const allowedOriginsEnv = (process.env.ALLOWED_ORIGINS || '').trim();
      const allowedList = allowedOriginsEnv
        ? allowedOriginsEnv.split(',').map((s) => s.trim()).filter(Boolean)
        : null;
      const allowMobileLanHttp = process.env.ALLOW_MOBILE_LAN_HTTP === 'true';
      const allowCloudflareTunnel = process.env.ALLOW_CLOUDFLARE_QUICK_TUNNEL === 'true';
      const isProd = process.env.NODE_ENV === 'production';

      const origin = req.get('origin');
      const corsOptions = {
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'Idempotency-Key',
          'X-Device-Info',
          'X-Device-Id',
          'X-Requested-With',
          'X-CSRF-Token',
        ],
        credentials: true,
      };
      if (!origin) return cb(null, { ...corsOptions, origin: true });
      if (
        capacitorOrigins.has(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
      ) {
        return cb(null, { ...corsOptions, origin: true });
      }
      if (allowedList && allowedList.some((pat) => matchesOriginPattern(origin, pat))) {
        return cb(null, { ...corsOptions, origin: true });
      }
      if (
        allowCloudflareTunnel &&
        /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(origin)
      ) {
        return cb(null, { ...corsOptions, origin: true });
      }
      if (
        allowMobileLanHttp &&
        /^https?:\/\/(192\.168|10|172\.(1[6-9]|2\d|3[01]))(\.\d{1,3}){2,3}(:\d+)?$/i.test(origin)
      ) {
        return cb(null, { ...corsOptions, origin: true });
      }
      // Same-host browser request behind verified trusted proxy or non-production dev server only when not bypassing production ALLOWED_ORIGINS
      if (!isProd || allowedList) {
        try {
          const originHost = new URL(origin).host.toLowerCase();
          const trustedProxyHost = app.get('trust proxy') ? req.get('x-forwarded-host') : '';
          const candidateHost = String(trustedProxyHost || req.get('host') || '')
            .split(',')[0]
            .trim()
            .toLowerCase();
          if (candidateHost && originHost === candidateHost && (!isProd || (allowedList && allowedList.some((pat) => matchesOriginPattern(origin, pat))))) {
            return cb(null, { ...corsOptions, origin: true });
          }
        } catch {
          // ignore malformed origin URL
        }
      }
      if (!allowedList && !isProd) {
        return cb(null, { ...corsOptions, origin: true });
      }
      return cb(new AppError(403, 'Origin not allowed by CORS', 'CORS_FORBIDDEN'));
    })
  );

  // Higher 50mb payload allowance ONLY on media/backup/sync endpoints before 5mb global parser
  const largeJsonParser = express.json({ limit: '50mb' });
  app.use('/api/database', largeJsonParser);
  app.use('/api/admin/backup', largeJsonParser);
  app.use('/api/customers', largeJsonParser);
  app.use('/api/products', largeJsonParser);
  app.use('/api/orders', largeJsonParser);
  app.use('/api/inventory', largeJsonParser);
  app.use('/api/sync', largeJsonParser);
  app.use(express.json({ limit: '5mb' }));

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
    asyncHandler(async (req, res) => {
      const strict = isStrictPostgresMode();
      const pgStatus = await checkPostgresHealth();
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
      const httpsActive = isRequestHttps(req);
      const forwardedProto = httpsActive ? 'https' : 'http';
      const tunnelState = getTunnelRuntimeStatus();

      if (strict && pgStatus.status !== 'online') {
        markPgUnavailable(pgStatus.status || 'connection_failed');
        return res.status(503).json({
          ok: false,
          code: DATABASE_UNAVAILABLE_CODE,
          error: DATABASE_UNAVAILABLE_MESSAGE,
          service: 'AWLAD SELIM Enterprise Server',
          version: '3.0.0',
          timestamp: new Date().toISOString(),
          strictMode: true,
          databaseAvailable: false,
          mode: 'postgresql-strict-unavailable',
          activeMode: null,
          tunnelStatus: { status: tunnelState.status, provider: tunnelState.provider },
          port,
          protocol: forwardedProto,
          httpsActive,
          connectionModesSupported: ['local_network', 'free_remote', 'pro_remote', 'cloud_vps'],
          lanUrls: lanIps.map((ip) => `http://${ip}:${port}`),
          postgres: {
            configured: pgStatus.configured,
            status: pgStatus.status,
            latencyMs: pgStatus.latencyMs,
            message: DATABASE_UNAVAILABLE_MESSAGE,
          },
        });
      }

      if (strict && pgStatus.status === 'online') {
        await ensureStrictPgReady({ forceHealthCheck: false });
      }

      const authStatus = await getAuthStatus();
      const sysSettings = await getSystemSettingsSafe();
      const activeMode = sysSettings?.extraSettings?.connectionConfig?.activeMode || 'local_network';

      res.json({
        ok: true,
        service: 'AWLAD SELIM Enterprise Server',
        version: '3.0.0',
        timestamp: new Date().toISOString(),
        strictMode: strict,
        databaseAvailable: pgStatus.status === 'online',
        mode: pgStatus.status === 'online' ? 'postgresql-enterprise' : 'local-json-ledger',
        activeMode,
        tunnelStatus: { status: tunnelState.status, provider: tunnelState.provider },
        needsAdminSetup: authStatus.needsAdminSetup,
        installationId: authStatus.installationId,
        port,
        protocol: forwardedProto,
        httpsActive,
        connectionModesSupported: ['local_network', 'free_remote', 'pro_remote', 'cloud_vps'],
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

  // Enforce Production Strict Mode availability check across ALL DB-dependent /api routes
  app.use(
    '/api',
    asyncHandler(async (req, _res, next) => {
      if (req.method === 'OPTIONS' || req.path === '/health') {
        return next();
      }
      await ensureStrictPgReady();
      return next();
    })
  );

  // App Links / Universal Links & Direct Device Pairing Landing Pages (must precede SPA fallback)
  app.use('/', pairingPublicPagesRouter);

  // Scoped Modular REST APIs
  app.use('/api', pairingApiRouter);
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
  app.use('/api/reports', reportsRoutes);

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

  app.use(errorMiddleware);
  return app;
}

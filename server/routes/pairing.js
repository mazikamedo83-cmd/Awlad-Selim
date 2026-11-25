import { Router } from 'express';
import { asyncHandler, checkPairingRateLimit } from '../middleware/auth.js';
import { isPgConnectionError, isStrictPostgresMode } from '../db/postgres.js';
import {
  DATABASE_UNAVAILABLE_CODE,
  DATABASE_UNAVAILABLE_MESSAGE,
  markPgUnavailable,
} from '../db/stores/mode.js';
import {
  claimPairingToken,
  getConnectionDiscoveryPayload,
  inspectPairingTokenPublic,
  parseValidAndroidSha256Fingerprints,
  recordDeviceHeartbeat,
  updateTunnelRuntimeStatus,
} from '../db/stores/connectionPairingStore.js';

function escapeHtml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isLoopbackIp(req) {
  const ip = String(req.socket?.remoteAddress || req.ip || '').trim();
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export const pairingApiRouter = Router();
export const pairingPublicPagesRouter = Router();

// Public Connection Discovery Endpoint
pairingApiRouter.get(
  '/connection/discovery',
  checkPairingRateLimit,
  asyncHandler(async (req, res) => {
    const payload = await getConnectionDiscoveryPayload(req);
    res.json(payload);
  })
);

// Public / Client Pairing Token Claim Endpoint
pairingApiRouter.post(
  '/pairing/claim',
  checkPairingRateLimit,
  asyncHandler(async (req, res) => {
    const result = await claimPairingToken(req.body || {}, req);
    res.json(result);
  })
);

// Device Connection Heartbeat
pairingApiRouter.post(
  '/connection/heartbeat',
  asyncHandler(async (req, res) => {
    const payload = await recordDeviceHeartbeat(req.body?.deviceId, req.body || {}, req);
    res.json(payload);
  })
);

// Internal Loopback Tunnel Supervisor Hook
pairingApiRouter.post(
  '/internal/tunnel-status',
  asyncHandler(async (req, res) => {
    const configuredSecret = String(process.env.TUNNEL_SUPERVISOR_TOKEN || '').trim();
    const suppliedSecret = String(req.get('x-tunnel-token') || '').trim();
    if (configuredSecret) {
      if (suppliedSecret !== configuredSecret) {
        return res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'رمز مشرف النفق غير صالح' });
      }
    } else if (!isLoopbackIp(req)) {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_NON_LOOPBACK',
        error: 'تحديث حالة النفق متاح فقط من الجهاز المحلي (Loopback)',
      });
    }
    const result = await updateTunnelRuntimeStatus(req.body || {}, null);
    res.json({ ok: true, ...result });
  })
);

// Android Digital Asset Links
pairingPublicPagesRouter.get('/.well-known/assetlinks.json', (_req, res) => {
  const pkg = String(process.env.ANDROID_APP_ID || 'com.awladselim.erp').trim();
  const fingerprints = parseValidAndroidSha256Fingerprints(
    process.env.ANDROID_APP_SHA256_FINGERPRINTS || ''
  );
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (fingerprints.length === 0) {
    return res.json([]);
  }
  return res.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: pkg,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
});

// Apple Universal Links AASA
pairingPublicPagesRouter.get('/.well-known/apple-app-site-association', (_req, res) => {
  const teamId = String(process.env.APPLE_TEAM_ID || '').trim();
  const bundleId = String(process.env.IOS_APP_BUNDLE_ID || 'com.awladselim.erp').trim();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!teamId) {
    return res.json({ applinks: { apps: [], details: [] } });
  }
  return res.json({
    applinks: {
      apps: [],
      details: [
        {
          appID: `${teamId}.${bundleId}`,
          paths: ['/pair/*', '/invite/*'],
        },
      ],
    },
  });
});

async function handlePublicPairingLanding(req, res) {
  const wantsJson =
    String(req.query?.format || '').toLowerCase() === 'json' ||
    String(req.get('accept') || '').toLowerCase().includes('application/json');

  try {
    const rawToken = String(req.params.token || '').trim();
    const inspection = await inspectPairingTokenPublic(rawToken);
    const discovery = await getConnectionDiscoveryPayload(req);
    const serverBaseUrl = escapeHtml(
      inspection.tokenRecord?.serverBaseUrl || discovery.currentHostUrl || discovery.activeEndpoint
    );
    const deepLinkUrl = `awladselim://pair?token=${encodeURIComponent(rawToken)}&server=${encodeURIComponent(
      inspection.tokenRecord?.serverBaseUrl || discovery.currentHostUrl || discovery.activeEndpoint
    )}`;

    if (wantsJson) {
      return res.json({
        ok: inspection.valid,
        status: inspection.status,
        companyName: discovery.companyName,
        serverBaseUrl: inspection.tokenRecord?.serverBaseUrl || discovery.currentHostUrl,
        deepLinkUrl,
        tokenPreview: inspection.tokenRecord?.tokenPreview || null,
        expiresAt: inspection.tokenRecord?.expiresAt || null,
        requireAdminApproval: Boolean(inspection.tokenRecord?.requireAdminApproval),
      });
    }

    const statusBadge =
      inspection.status === 'active'
        ? 'رابط ربط صالح وجاهز للتفعيل'
        : inspection.status === 'used'
        ? 'تم استخدام هذا الرابط مسبقاً'
        : inspection.status === 'revoked'
        ? 'تم إلغاء هذا الرابط من الإدارة'
        : inspection.status === 'expired'
        ? 'انتهت صلاحية هذا الرابط'
        : 'رمز الربط غير صالح';

    return res.status(inspection.valid ? 200 : 410).send(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ربط جهاز — ${escapeHtml(discovery.companyName)}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background:#eef3fa; color:#0f172a; margin:0; padding:24px; }
    .card { max-width:520px; margin:24px auto; background:#fff; border:1px solid #dce6f5; border-radius:12px; overflow:hidden; box-shadow:0 10px 30px rgba(1,30,88,.12); }
    .hdr { background:linear-gradient(135deg,#011E58,#003589); color:#fff; padding:18px 20px; }
    .body { padding:20px; line-height:1.7; font-size:14px; }
    .btn { display:inline-block; background:#003589; color:#fff; text-decoration:none; font-weight:700; padding:11px 18px; border-radius:8px; margin-top:10px; }
    .code { background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:10px; font-family:monospace; direction:ltr; word-break:break-all; font-size:12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="hdr">
      <h1 style="margin:0;font-size:18px;">AWLAD SELIM — ${escapeHtml(discovery.companyName)}</h1>
      <div style="font-size:12px;opacity:.9;margin-top:4px;">${escapeHtml(statusBadge)}</div>
    </div>
    <div class="body">
      <p>يُستخدم هذا الرابط لإعداد عنوان السيرفر المركزي تلقائياً داخل تطبيق أولاد سليم.</p>
      <div class="code">${serverBaseUrl}</div>
      ${
        inspection.valid
          ? `<p><a class="btn" href="${escapeHtml(deepLinkUrl)}">فتح التطبيق وتفعيل الربط تلقائياً</a></p>
             <p style="font-size:12px;color:#475569;">أو انسخ هذا الرابط والصقه داخل شاشة مسح QR / لصق رابط الدعوة في التطبيق.</p>`
          : `<p style="color:#b91c1c;font-weight:700;">يرجى طلب رابط ربط جديد من مدير النظام.</p>`
      }
    </div>
  </div>
</body>
</html>`);
  } catch (err) {
    const isUnavailable =
      err?.code === DATABASE_UNAVAILABLE_CODE ||
      err?.status === 503 ||
      (isStrictPostgresMode() && isPgConnectionError(err));
    if (isUnavailable) {
      markPgUnavailable(err?.code || 'connection_error');
      const prefersHtml =
        !wantsJson &&
        String(req.get('accept') || '').toLowerCase().includes('text/html') &&
        !String(req.get('content-type') || '').toLowerCase().includes('application/json');
      if (!prefersHtml) {
        return res.status(503).json({
          ok: false,
          code: DATABASE_UNAVAILABLE_CODE,
          error: DATABASE_UNAVAILABLE_MESSAGE,
        });
      }
      return res.status(503).send(`<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8" /><title>PostgreSQL غير متاحة</title></head>
<body style="font-family:system-ui,sans-serif;padding:24px;direction:rtl;">
  <h2>PostgreSQL — قاعدة البيانات المركزية غير متاحة مؤقتاً</h2>
  <p>${escapeHtml(DATABASE_UNAVAILABLE_MESSAGE)}</p>
</body>
</html>`);
    }
    throw err;
  }
}

pairingPublicPagesRouter.get('/pair/:token', asyncHandler(handlePublicPairingLanding));
pairingPublicPagesRouter.get('/invite/:token', asyncHandler(handlePublicPairingLanding));

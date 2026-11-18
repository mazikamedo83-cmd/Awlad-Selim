import { Router } from 'express';
import {
  getPublicConnectionDiscovery,
  resolvePairingToken,
  claimPairingToken,
  recordDeviceHeartbeat,
  updateTunnelRuntimeStatus,
  parseValidAndroidSha256Fingerprints,
} from '../db/stores/connectionPairingStore.js';
import { validateActiveSession } from '../db/stores/authStore.js';
import { verifyJwt } from '../utils/crypto.js';
import { asyncHandler, checkPairingRateLimit, getClientIp } from '../middleware/auth.js';

function escapeHtml(raw) {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function detectPlatformFromUa(ua = '') {
  const s = String(ua || '').toLowerCase();
  if (/iphone|ipad|ipod/.test(s)) return 'ios';
  if (/android/.test(s)) return 'android';
  if (/windows/.test(s)) return 'windows';
  return 'other';
}

function modeArabicLabel(mode) {
  switch (mode) {
    case 'local_network':
      return 'الشبكة المحلية (LAN + منفذ 3000)';
    case 'free_remote':
      return 'الاتصال الخارجي المجاني (Cloudflare Quick Tunnel)';
    case 'pro_remote':
      return 'الاتصال الخارجي الاحترافي (دومين ثابت + HTTPS)';
    case 'cloud_vps':
      return 'السيرفر السحابي الدائم (Cloud VPS)';
    default:
      return mode || 'اتصال تلقائي';
  }
}

function isDirectLoopback(req) {
  if (req.get('x-forwarded-for')) return false;
  const addr = String(req.socket?.remoteAddress || req.ip || '').trim();
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

async function resolveOptionalAuthUser(req) {
  try {
    const authHeader = req.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) return null;
    const payload = verifyJwt(token);
    if (!payload?.sub || !payload?.sid) return null;
    const sessionCtx = await validateActiveSession(payload.sid, payload.sub);
    return sessionCtx?.user || null;
  } catch {
    return null;
  }
}

export const pairingApiRouter = Router();

pairingApiRouter.get(
  '/connection/discovery',
  asyncHandler(async (req, res) => {
    const discovery = await getPublicConnectionDiscovery(req);
    res.json(discovery);
  })
);

pairingApiRouter.post(
  '/connection/heartbeat',
  checkPairingRateLimit,
  asyncHandler(async (req, res) => {
    const authUser = await resolveOptionalAuthUser(req);
    const result = await recordDeviceHeartbeat(
      { ...(req.body || {}), ipAddress: getClientIp(req) },
      req,
      authUser
    );
    if (result.ok === false) {
      return res.status(403).json(result);
    }
    return res.json(result);
  })
);

pairingApiRouter.get(
  '/pairing/resolve/:token',
  checkPairingRateLimit,
  asyncHandler(async (req, res) => {
    const result = await resolvePairingToken(req.params.token, req);
    res.json(result);
  })
);

pairingApiRouter.post(
  '/pairing/claim',
  checkPairingRateLimit,
  asyncHandler(async (req, res) => {
    const result = await claimPairingToken(
      {
        ...(req.body || {}),
        deviceId: req.get('x-device-id') || req.body?.deviceId,
        ipAddress: getClientIp(req),
      },
      req
    );
    res.json(result);
  })
);

pairingApiRouter.post(
  '/internal/tunnel-status',
  asyncHandler(async (req, res) => {
    const user = await resolveOptionalAuthUser(req);
    const isAdminOrPermitted = Boolean(user && (user.role === 'admin' || user.permissions?.canManageSettings));
    if (!isDirectLoopback(req) && !isAdminOrPermitted) {
      return res.status(403).json({
        ok: false,
        code: 'FORBIDDEN_TUNNEL_UPDATE',
        error: 'غير مصرح بتحديث حالة النفق إلا من الجهاز الخادم أو مدير الإعدادات.',
      });
    }
    const result = await updateTunnelRuntimeStatus(req.body || {}, user);
    res.json({ ok: true, ...result });
  })
);

export const pairingPublicPagesRouter = Router();

pairingPublicPagesRouter.get('/.well-known/assetlinks.json', (req, res) => {
  const packageName = (process.env.ANDROID_APP_ID || 'com.awladselim.erp').trim();
  const configuredHost = String(process.env.ANDROID_APP_LINK_HOST || '').trim().toLowerCase();
  const fingerprints = parseValidAndroidSha256Fingerprints(process.env.ANDROID_APP_SHA256_FINGERPRINTS || '');

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (fingerprints.length === 0 || configuredHost === 'awladselim.app') {
    return res.json([]);
  }
  if (configuredHost) {
    const reqHost = String(req.get('x-forwarded-host') || req.get('host') || '')
      .split(',')[0]
      .trim()
      .split(':')[0]
      .toLowerCase();
    if (reqHost && reqHost !== configuredHost) {
      return res.json([]);
    }
  }
  return res.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
});

pairingPublicPagesRouter.get('/.well-known/apple-app-site-association', (_req, res) => {
  const teamId = String(process.env.APPLE_TEAM_ID || '').trim();
  const bundleId = String(process.env.IOS_BUNDLE_ID || 'com.awladselim.erp').trim();
  const appId = teamId ? `${teamId}.${bundleId}` : bundleId;

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.json({
    applinks: {
      apps: [],
      details: [
        {
          appID: appId,
          paths: ['/pair/*', '/invite/*'],
        },
      ],
    },
  });
});

async function handleInviteLandingPage(req, res) {
  const rawToken = String(req.params.token || '').trim();
  const wantJson = req.query.format === 'json' || (!req.accepts('html') && req.accepts('json'));

  try {
    const info = await resolvePairingToken(rawToken, req);
    if (wantJson) {
      return res.json(info);
    }

    const platform = detectPlatformFromUa(req.get('user-agent') || '');
    const platformLabel =
      platform === 'android'
        ? 'Android'
        : platform === 'ios'
        ? 'iPhone / iPad (iOS)'
        : platform === 'windows'
        ? 'Windows Desktop'
        : 'المتصفح';

    const deepLink = `awladselim://pair?token=${encodeURIComponent(rawToken)}&server=${encodeURIComponent(info.endpointUrl)}`;
    const webAppLink = `/?pair_token=${encodeURIComponent(rawToken)}`;
    const androidApkUrl = String(process.env.ANDROID_APK_URL || '').trim();
    const iosStoreUrl = String(process.env.IOS_TESTFLIGHT_URL || process.env.IOS_APP_STORE_URL || '').trim();
    const windowsUrl = String(process.env.WINDOWS_DOWNLOAD_URL || '').trim();

    let downloadBlockHtml = '';
    if (platform === 'android') {
      downloadBlockHtml = androidApkUrl
        ? `<a class="btn btn-secondary" href="${escapeHtml(androidApkUrl)}">تنزيل تطبيق الأندرويد (APK)</a>`
        : `<p class="hint">إذا لم يكن تطبيق AWLAD SELIM مثبتًا على جهاز الأندرويد، اطلب ملف التثبيت (APK) من الإدارة ثم افتح هذا الرابط مجددًا.</p>`;
    } else if (platform === 'ios') {
      downloadBlockHtml = iosStoreUrl
        ? `<a class="btn btn-secondary" href="${escapeHtml(iosStoreUrl)}">تنزيل تطبيق الأيفون (iOS)</a>`
        : `<p class="hint">إذا لم يكن تطبيق AWLAD SELIM مثبتًا على الأيفون، قم بتثبيته عبر TestFlight أو App Store ثم افتح الرابط مجددًا.</p>`;
    } else if (platform === 'windows') {
      downloadBlockHtml = windowsUrl
        ? `<a class="btn btn-secondary" href="${escapeHtml(windowsUrl)}">تنزيل برنامج الويندوز (Windows Installer)</a>`
        : `<p class="hint">يمكنك تثبيت نسخة Windows Desktop من قسم الإصدارات أو متابعة العمل مباشرة عبر المتصفح بالأسفل.</p>`;
    }

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ربط جهاز مع ${escapeHtml(info.companyName)} — AWLAD SELIM</title>
  <style>
    * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; }
    body { margin: 0; min-height: 100vh; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { width: 100%; max-width: 520px; background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 28px; box-shadow: 0 20px 50px rgba(0,0,0,0.4); }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 8px; background: #064e3b; color: #6ee7b7; font-size: 13px; font-weight: 700; margin-bottom: 12px; }
    h1 { margin: 0 0 8px; font-size: 22px; color: #ffffff; }
    .sub { color: #cbd5e1; font-size: 14px; line-height: 1.7; margin-bottom: 20px; }
    .box { background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 14px; margin-bottom: 18px; font-size: 13px; }
    .row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid #1e293b; }
    .row:last-child { border-bottom: 0; }
    .lbl { color: #94a3b8; }
    .val { color: #f1f5f9; font-weight: 600; word-break: break-all; }
    .ltr { direction: ltr; text-align: left; font-family: Consolas, monospace; }
    .btn { display: block; width: 100%; text-align: center; text-decoration: none; padding: 13px 16px; border-radius: 10px; font-weight: 700; font-size: 15px; margin-bottom: 10px; border: 0; cursor: pointer; }
    .btn-primary { background: #059669; color: #ffffff; }
    .btn-web { background: #0284c7; color: #ffffff; }
    .btn-secondary { background: #334155; color: #f8fafc; }
    .notice { background: #451a03; border: 1px solid #92400e; color: #fde68a; border-radius: 10px; padding: 11px 14px; font-size: 13px; line-height: 1.6; margin-bottom: 16px; }
    .hint { color: #94a3b8; font-size: 13px; line-height: 1.6; background: #0f172a; padding: 10px 12px; border-radius: 10px; border: 1px dashed #475569; }
    code { background: #0f172a; padding: 2px 6px; border-radius: 6px; color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">دعوة ربط جهاز — ${escapeHtml(platformLabel)}</div>
    <h1>${escapeHtml(info.companyName)}</h1>
    <p class="sub">تم تجهيز إعدادات الاتصال التلقائي بالسيرفر المركزي لجهازك. بعد فتح التطبيق، سيُطلب منك تسجيل الدخول باسم المستخدم وكلمة المرور المعتادة.</p>

    <div class="box">
      <div class="row"><span class="lbl">وضع الاتصال:</span><span class="val">${escapeHtml(modeArabicLabel(info.activeMode))}</span></div>
      <div class="row"><span class="lbl">عنوان السيرفر:</span><span class="val ltr">${escapeHtml(info.endpointUrl)}</span></div>
      ${info.targetUserName ? `<div class="row"><span class="lbl">الحساب المقصود:</span><span class="val">${escapeHtml(info.targetUserName)}</span></div>` : ''}
      <div class="row"><span class="lbl">ينتهي في:</span><span class="val ltr">${escapeHtml(new Date(info.expiresAt).toLocaleString('en-GB'))}</span></div>
    </div>

    ${
      info.requireAdminApproval
        ? `<div class="notice">ملاحظة أمنية: يتطلب هذا الرابط اعتماد مدير النظام للجهاز قبل تفعيل الدخول.</div>`
        : ''
    }

    <a id="open-app-btn" class="btn btn-primary" href="${escapeHtml(deepLink)}">فتح تطبيق AWLAD SELIM وإعداد الاتصال تلقائيًا</a>
    <a class="btn btn-web" href="${escapeHtml(webAppLink)}">متابعة الربط والدخول عبر المتصفح مباشرة</a>
    ${downloadBlockHtml}

    <p class="hint">في حال استخدام التطبيق يدويًا، افتح شاشة <strong>"إعداد السيرفر"</strong> واختر <strong>"لصق رابط الدعوة"</strong> أو امسح رمز QR.</p>
  </div>
  ${
    platform === 'android' || platform === 'ios'
      ? `<script>
    setTimeout(function () {
      try { window.location.href = ${JSON.stringify(deepLink)}; } catch (e) {}
    }, 350);
  </script>`
      : ''
  }
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err) {
    if (wantJson) {
      throw err;
    }
    const status = err?.status || 400;
    const msg = err?.message || 'رابط الربط غير صالح أو منتهي الصلاحية.';
    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>رابط ربط غير صالح — AWLAD SELIM</title>
  <style>
    body { margin: 0; min-height: 100vh; background: #0f172a; color: #f8fafc; font-family: 'Segoe UI', Tahoma, sans-serif; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { max-width: 460px; width: 100%; background: #1e293b; border: 1px solid #7f1d1d; border-radius: 16px; padding: 26px; text-align: center; }
    h1 { color: #fca5a5; font-size: 20px; margin-bottom: 10px; }
    p { color: #cbd5e1; line-height: 1.7; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>تعذر إتمام ربط الجهاز</h1>
    <p>${escapeHtml(msg)}</p>
    <p>يرجى التواصل مع مسؤول النظام لإصدار رابط ربط أو رمز QR جديد.</p>
  </div>
</body>
</html>`;
    res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8').send(html);
  }
}

pairingPublicPagesRouter.get('/pair/:token', asyncHandler(handleInviteLandingPage));
pairingPublicPagesRouter.get('/invite/:token', asyncHandler(handleInviteLandingPage));

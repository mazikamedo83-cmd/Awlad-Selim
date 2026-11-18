import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const QUICK_TUNNEL_URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com(?::\d+)?/i;

export function extractQuickTunnelUrl(rawText = '') {
  const match = String(rawText || '').match(QUICK_TUNNEL_URL_REGEX);
  if (!match) return '';
  try {
    const parsed = new URL(match[0]);
    if (parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

export function buildTunnelStatusPayload({
  mode = 'quick',
  status = 'offline',
  tunnelUrl = '',
  localPort = 3000,
  error = null,
} = {}) {
  return {
    status,
    provider: mode === 'named' ? 'cloudflared_named' : 'cloudflared_quick',
    tunnelUrl: tunnelUrl ? String(tunnelUrl).trim().replace(/\/+$/, '') : '',
    localPort: Number(localPort || 3000) || 3000,
    error: error ? String(error).slice(0, 300) : null,
  };
}

function loadHostEnv() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, '..');
  const candidates = [];
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'AWLAD SELIM', '.env'));
  } else {
    candidates.push(path.join(os.homedir(), '.config', 'awlad-selim', '.env'));
  }
  candidates.push(path.join(projectRoot, '.env'));

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  }
}

function parseCliArgs(argv = []) {
  let mode = 'quick';
  let port = Number(process.env.PORT || process.env.API_PORT || 3000) || 3000;
  let apiUrl = '';

  for (const arg of argv) {
    if (arg.startsWith('--mode=')) {
      const val = arg.slice('--mode='.length).trim().toLowerCase();
      if (val === 'quick' || val === 'named') mode = val;
    } else if (arg.startsWith('--port=')) {
      const p = Number(arg.slice('--port='.length).trim());
      if (Number.isInteger(p) && p >= 1 && p <= 65535) port = p;
    } else if (arg.startsWith('--api-url=')) {
      apiUrl = arg.slice('--api-url='.length).trim().replace(/\/+$/, '');
    }
  }

  return {
    mode,
    port,
    apiUrl: apiUrl || `http://127.0.0.1:${port}`,
  };
}

export async function reportTunnelStatus(apiBaseUrl, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(`${apiBaseUrl}/api/internal/tunnel-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, error: err?.message || 'UNREACHABLE' };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForLocalServerHealth(apiBaseUrl) {
  for (;;) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${apiBaseUrl}/api/health`, { signal: controller.signal }).finally(() =>
        clearTimeout(timer)
      );
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.ok) return true;
      }
    } catch {
      // retry until local server is up
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}

async function runSupervisor() {
  loadHostEnv();
  const { mode, port, apiUrl } = parseCliArgs(process.argv.slice(2));
  const cloudflaredBin = process.env.CLOUDFLARED_BIN || 'cloudflared';
  const namedToken = String(process.env.CLOUDFLARE_TUNNEL_TOKEN || '').trim();
  const staticNamedUrl = String(process.env.CLOUDFLARE_TUNNEL_PUBLIC_URL || '').trim();

  if (mode === 'named' && !namedToken) {
    console.error('[AWLAD Tunnel] ERROR: CLOUDFLARE_TUNNEL_TOKEN غير مضبوط في متغيرات البيئة أو ملف .env.');
    console.error('[AWLAD Tunnel] أضف CLOUDFLARE_TUNNEL_TOKEN=... في ملف .env على جهاز السيرفر فقط (وليس في قاعدة البيانات).');
    process.exit(1);
  }

  let shuttingDown = false;
  let currentChild = null;
  let activeUrl = mode === 'named' ? staticNamedUrl : '';
  let backoffMs = 3000;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[AWLAD Tunnel] تم استلام ${signal} — جاري إغلاق النفق بأمان...`);
    if (currentChild && !currentChild.killed) {
      currentChild.kill('SIGTERM');
    }
    await reportTunnelStatus(
      apiUrl,
      buildTunnelStatusPayload({
        mode,
        status: 'offline',
        tunnelUrl: '',
        localPort: port,
      })
    );
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  console.log(`[AWLAD Tunnel] Mode=${mode} | Target=http://127.0.0.1:${port}`);
  console.log(`[AWLAD Tunnel] Waiting for local central server (${apiUrl}/api/health)...`);
  await waitForLocalServerHealth(apiUrl);
  console.log('[AWLAD Tunnel] Local central server is UP. Starting cloudflared...');

  while (!shuttingDown) {
    let resolvedOnline = false;
    activeUrl = mode === 'named' ? staticNamedUrl : '';

    await reportTunnelStatus(
      apiUrl,
      buildTunnelStatusPayload({
        mode,
        status: 'starting',
        tunnelUrl: activeUrl,
        localPort: port,
      })
    );

    const args =
      mode === 'named'
        ? ['tunnel', '--no-autoupdate', 'run', '--token', namedToken]
        : ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`];

    const child = spawn(cloudflaredBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });
    currentChild = child;

    const heartbeatInterval = setInterval(() => {
      if (resolvedOnline && !shuttingDown) {
        void reportTunnelStatus(
          apiUrl,
          buildTunnelStatusPayload({
            mode,
            status: 'online',
            tunnelUrl: activeUrl,
            localPort: port,
          })
        );
      }
    }, 60000);

    const handleOutputChunk = async (chunk) => {
      const text = chunk.toString('utf8');
      process.stdout.write(text);

      if (mode === 'quick') {
        const discoveredUrl = extractQuickTunnelUrl(text);
        if (discoveredUrl && discoveredUrl !== activeUrl) {
          activeUrl = discoveredUrl;
          resolvedOnline = true;
          backoffMs = 3000;
          console.log(`\n[AWLAD Tunnel] تم التقاط رابط النفق السريع تلقائياً: ${activeUrl}`);
          const reported = await reportTunnelStatus(
            apiUrl,
            buildTunnelStatusPayload({
              mode,
              status: 'online',
              tunnelUrl: activeUrl,
              localPort: port,
            })
          );
          if (reported.ok && reported.data?.configUpdated) {
            console.log('[AWLAD Tunnel] تم تحديث إعدادات Free Remote وتعميم الإصدار للأجهزة تلقائياً.');
          }
        }
      } else if (!resolvedOnline && /registered tunnel connection/i.test(text)) {
        resolvedOnline = true;
        backoffMs = 3000;
        console.log('\n[AWLAD Tunnel] تم الاتصال بنفق Cloudflare Named Tunnel بنجاح.');
        await reportTunnelStatus(
          apiUrl,
          buildTunnelStatusPayload({
            mode,
            status: 'online',
            tunnelUrl: activeUrl,
            localPort: port,
          })
        );
      }
    };

    child.stdout.on('data', (chunk) => {
      void handleOutputChunk(chunk);
    });
    child.stderr.on('data', (chunk) => {
      void handleOutputChunk(chunk);
    });

    const exitResult = await new Promise((resolve) => {
      child.on('error', (err) => resolve({ code: -1, error: err.message }));
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });

    clearInterval(heartbeatInterval);
    currentChild = null;

    if (shuttingDown) break;

    const errMsg = exitResult.error
      ? `تعذر تشغيل cloudflared: ${exitResult.error}`
      : `توقف النفق (code=${exitResult.code ?? 'null'}, signal=${exitResult.signal ?? 'none'})`;

    console.warn(`\n[AWLAD Tunnel] ${errMsg}. إعادة المحاولة خلال ${Math.round(backoffMs / 1000)} ثانية...`);
    await reportTunnelStatus(
      apiUrl,
      buildTunnelStatusPayload({
        mode,
        status: 'error',
        tunnelUrl: '',
        localPort: port,
        error: errMsg,
      })
    );

    await new Promise((r) => setTimeout(r, backoffMs));
    backoffMs = Math.min(30000, backoffMs * 2);
  }
}

const isEntrypoint =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  runSupervisor().catch((err) => {
    console.error('[AWLAD Tunnel] Fatal supervisor error:', err);
    process.exit(1);
  });
}

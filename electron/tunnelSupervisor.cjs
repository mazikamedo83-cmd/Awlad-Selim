const { spawn } = require('node:child_process');

/**
 * Opt-in Cloudflare Tunnel Supervisor for Windows Desktop (Electron).
 * Never starts automatically unless explicitly requested by the administrator.
 */
function createTunnelSupervisor({ getPort, onStatusChange } = {}) {
  let childProc = null;
  let restartTimer = null;
  let userStopped = true;
  let lastStartOpts = null;

  let state = {
    status: 'offline', // 'offline' | 'starting' | 'online' | 'error'
    provider: 'cloudflared_quick', // 'cloudflared_quick' | 'cloudflared_named'
    tunnelUrl: '',
    localPort: Number(typeof getPort === 'function' ? getPort() : 3000) || 3000,
    pid: null,
    restartCount: 0,
    lastError: null,
    startedAt: null,
    updatedAt: null,
  };

  function emitState(nextPartial = {}) {
    state = {
      ...state,
      ...nextPartial,
      localPort: Number(typeof getPort === 'function' ? getPort() : state.localPort) || 3000,
      updatedAt: new Date().toISOString(),
    };
    if (typeof onStatusChange === 'function') {
      try {
        onStatusChange({ ...state });
      } catch {
        // Ignore observer errors
      }
    }
    syncStatusToLocalServer(state).catch(() => {});
  }

  async function syncStatusToLocalServer(snapshot) {
    const port = snapshot.localPort || 3000;
    try {
      await fetch(`http://127.0.0.1:${port}/api/internal/tunnel-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: snapshot.status,
          provider: snapshot.provider,
          tunnelUrl: snapshot.tunnelUrl,
          localPort: port,
          error: snapshot.lastError,
        }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Server may still be starting or already shutting down
    }
  }

  function clearRestartTimer() {
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  }

  function killChildProcess() {
    const proc = childProc;
    childProc = null;
    if (!proc) return;
    try {
      proc.removeAllListeners();
      if (!proc.killed) {
        proc.kill('SIGTERM');
        if (process.platform === 'win32' && proc.pid) {
          setTimeout(() => {
            try {
              spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            } catch {
              // ignore
            }
          }, 800);
        }
      }
    } catch {
      // ignore
    }
  }

  function spawnTunnelProcess(opts, isRetry = false) {
    clearRestartTimer();
    killChildProcess();

    const mode = opts.mode === 'pro_remote' ? 'pro_remote' : 'free_remote';
    const provider = mode === 'pro_remote' ? 'cloudflared_named' : 'cloudflared_quick';
    const localPort = Number(typeof getPort === 'function' ? getPort() : 3000) || 3000;
    const binPath = String(opts.cloudflaredPath || process.env.CLOUDFLARED_PATH || 'cloudflared').trim() || 'cloudflared';

    let args;
    let configuredDomain = '';
    if (mode === 'pro_remote') {
      const token = String(opts.token || '').trim();
      if (!token) {
        emitState({
          status: 'error',
          provider,
          tunnelUrl: '',
          pid: null,
          lastError: 'مطلوب إدخال Token الخاص بـ Cloudflare Named Tunnel لتشغيل النفق الاحترافي.',
        });
        return { ok: false, error: state.lastError, status: getStatus() };
      }
      if (opts.domainUrl) {
        const clean = String(opts.domainUrl).trim().replace(/\/+$/, '');
        if (clean.startsWith('https://')) {
          configuredDomain = clean;
        }
      }
      args = ['tunnel', '--no-autoupdate', 'run', '--token', token];
    } else {
      args = ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${localPort}`];
    }

    emitState({
      status: 'starting',
      provider,
      tunnelUrl: mode === 'pro_remote' ? configuredDomain : '',
      localPort,
      lastError: null,
      restartCount: isRetry ? state.restartCount + 1 : 0,
      startedAt: state.startedAt || new Date().toISOString(),
    });

    let spawned;
    try {
      spawned = spawn(binPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      emitState({
        status: 'error',
        provider,
        pid: null,
        lastError: err?.code === 'ENOENT'
          ? 'برنامج cloudflared غير مثبت على هذا الجهاز أو غير موجود في PATH.'
          : err?.message || 'تعذر بدء تشغيل النفق الخارجي.',
      });
      return { ok: false, error: state.lastError, status: getStatus() };
    }

    childProc = spawned;
    emitState({ pid: spawned.pid || null });

    const handleLogChunk = (chunk) => {
      const text = String(chunk || '');
      if (mode === 'free_remote') {
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (match && match[0]) {
          const detectedUrl = match[0].toLowerCase();
          if (state.tunnelUrl !== detectedUrl || state.status !== 'online') {
            emitState({
              status: 'online',
              provider,
              tunnelUrl: detectedUrl,
              lastError: null,
              startedAt: state.startedAt || new Date().toISOString(),
            });
          }
        }
      } else if (/Registered tunnel connection|Connection .* registered/i.test(text)) {
        emitState({
          status: 'online',
          provider,
          tunnelUrl: configuredDomain || state.tunnelUrl,
          lastError: null,
          startedAt: state.startedAt || new Date().toISOString(),
        });
      }
    };

    spawned.stdout?.on('data', handleLogChunk);
    spawned.stderr?.on('data', handleLogChunk);

    spawned.on('error', (err) => {
      if (childProc !== spawned) return;
      childProc = null;
      const msg =
        err?.code === 'ENOENT'
          ? 'برنامج cloudflared غير مثبت على هذا الجهاز. يرجى تثبيته من Cloudflare أولاً ثم المحاولة.'
          : `خطأ في تشغيل النفق: ${err?.message || 'خطأ غير معروف'}`;
      emitState({
        status: 'error',
        pid: null,
        lastError: msg,
      });
    });

    spawned.on('exit', (code, signal) => {
      if (childProc !== spawned) return;
      childProc = null;
      if (userStopped) {
        emitState({
          status: 'offline',
          pid: null,
          tunnelUrl: '',
          startedAt: null,
          lastError: null,
        });
        return;
      }

      const maxRetries = 5;
      if (state.restartCount < maxRetries && lastStartOpts) {
        const delayMs = Math.min(30000, 2000 * Math.pow(2, state.restartCount));
        emitState({
          status: 'error',
          pid: null,
          lastError: `انقطع اتصال النفق (code=${code ?? signal}). جاري إعادة التشغيل التلقائي خلال ${Math.round(delayMs / 1000)} ثوانٍ...`,
        });
        restartTimer = setTimeout(() => {
          if (!userStopped && lastStartOpts) {
            spawnTunnelProcess(lastStartOpts, true);
          }
        }, delayMs);
      } else {
        emitState({
          status: 'error',
          pid: null,
          lastError: `توقف النفق بعد ${maxRetries} محاولات إعادة تشغيل (code=${code ?? signal}).`,
        });
      }
    });

    return { ok: true, status: getStatus() };
  }

  function start(opts = {}) {
    userStopped = false;
    lastStartOpts = { ...opts };
    return spawnTunnelProcess(lastStartOpts, false);
  }

  async function stop() {
    userStopped = true;
    lastStartOpts = null;
    clearRestartTimer();
    killChildProcess();
    emitState({
      status: 'offline',
      tunnelUrl: '',
      pid: null,
      restartCount: 0,
      startedAt: null,
      lastError: null,
    });
    return { ok: true, status: getStatus() };
  }

  function getStatus() {
    return { ...state };
  }

  return {
    start,
    stop,
    getStatus,
  };
}

module.exports = {
  createTunnelSupervisor,
};

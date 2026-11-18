import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function extractQuickTunnelUrl(logText) {
  const match = String(logText || '').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return match ? match[0].replace(/\/+$/, '') : '';
}

export function buildTunnelStatusPayload({
  mode = 'quick',
  status = 'offline',
  tunnelUrl = '',
  localPort = 3000,
  startedAt = null,
  lastError = null,
} = {}) {
  const provider = mode === 'named' ? 'cloudflared_named' : 'cloudflared_quick';
  const cleanUrl = String(tunnelUrl || '').trim().replace(/\/+$/, '');
  return {
    status,
    provider,
    tunnelUrl: cleanUrl,
    localPort: Number(localPort) || 3000,
    startedAt,
    updatedAt: new Date().toISOString(),
    lastError,
  };
}

async function postTunnelStatus(port, payload) {
  try {
    await fetch(`http://127.0.0.1:${port}/api/internal/tunnel-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // ignore transient server connection errors while starting
  }
}

function parseArgs(argv) {
  const opts = { mode: 'quick', port: 3000, token: '' };
  for (const arg of argv) {
    if (arg.startsWith('--mode=')) opts.mode = arg.slice(7).trim() || 'quick';
    else if (arg.startsWith('--port=')) opts.port = Number(arg.slice(7)) || 3000;
    else if (arg.startsWith('--token=')) opts.token = arg.slice(8).trim();
  }
  return opts;
}

async function runCli() {
  const { mode, port, token } = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  let lastUrl = '';

  await postTunnelStatus(
    port,
    buildTunnelStatusPayload({ mode, status: 'starting', localPort: port, startedAt })
  );

  const cfArgs =
    mode === 'named' && token
      ? ['tunnel', '--no-autoupdate', 'run', '--token', token]
      : ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`];

  const child = spawn('cloudflared', cfArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  const handleChunk = (chunk) => {
    const text = chunk.toString('utf8');
    process.stdout.write(text);
    if (mode === 'quick') {
      const detected = extractQuickTunnelUrl(text);
      if (detected && detected !== lastUrl) {
        lastUrl = detected;
        console.log(`\n[Tunnel Supervisor] Quick Tunnel URL detected: ${detected}`);
        postTunnelStatus(
          port,
          buildTunnelStatusPayload({
            mode,
            status: 'online',
            tunnelUrl: detected,
            localPort: port,
            startedAt,
          })
        );
      }
    }
  };

  child.stdout.on('data', handleChunk);
  child.stderr.on('data', handleChunk);

  child.on('error', async (err) => {
    console.error(`[Tunnel Supervisor] Failed to launch cloudflared: ${err.message}`);
    await postTunnelStatus(
      port,
      buildTunnelStatusPayload({
        mode,
        status: 'error',
        localPort: port,
        startedAt,
        lastError: err.message,
      })
    );
    process.exit(1);
  });

  child.on('exit', async (code) => {
    await postTunnelStatus(
      port,
      buildTunnelStatusPayload({
        mode,
        status: 'offline',
        tunnelUrl: lastUrl,
        localPort: port,
        startedAt,
        lastError: code ? `cloudflared exited with code ${code}` : null,
      })
    );
    process.exit(code || 0);
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      child.kill(sig);
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}

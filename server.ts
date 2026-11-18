import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiApp, initializeServerRuntime } from './server/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getCliArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag && args[i + 1] && !args[i + 1].startsWith('--')) {
      return args[i + 1];
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return undefined;
}

function resolveListenPort(): number {
  const cliPort = Number(getCliArg('--port'));
  if (Number.isInteger(cliPort) && cliPort > 0 && cliPort <= 65535) return cliPort;

  const envPortRaw = process.env.PORT;
  const nginxPort = process.env.NGINX_PORT;
  const safeEnvPort =
    envPortRaw && (!nginxPort || envPortRaw !== nginxPort) ? Number(envPortRaw) : 0;
  if (Number.isInteger(safeEnvPort) && safeEnvPort > 0 && safeEnvPort <= 65535) return safeEnvPort;

  const apiPort = Number(process.env.API_PORT || process.env.DEFAULT_APP_PORT || 3000);
  return Number.isInteger(apiPort) && apiPort > 0 && apiPort <= 65535 ? apiPort : 3000;
}

const port = resolveListenPort();
const host = getCliArg('--host') || process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

async function startUnifiedServer() {
  process.env.AWLAD_ACTIVE_PORT = String(port);
  await initializeServerRuntime();
  const app = createApiApp();
  const httpServer = http.createServer(app);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      const setNoCacheHeaders = (res: express.Response) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      };
      app.use(express.static(distDir, {
        index: false,
        setHeaders: (res, filePath) => {
          if (path.basename(filePath).toLowerCase() === 'index.html') {
            setNoCacheHeaders(res);
          }
        },
      }));
      app.get('*', (_req, res) => {
        setNoCacheHeaders(res);
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      console.log(`AWLAD SELIM Server (${isProduction ? 'production' : 'development'}) listening on http://${host}:${port}`);
      resolve();
    });
  });
}

startUnifiedServer().catch((err) => {
  console.error('[Server Startup Error]:', err);
  process.exit(1);
});

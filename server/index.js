import dotenv from 'dotenv';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApiApp, initializeServerRuntime } from './app.js';
import { flushJsonWrites, getDataPaths } from './db/jsonLedger.js';
import { closePostgresPool } from './db/postgres.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function loadEnvCandidates(extraEnvFiles = []) {
  const candidates = [
    ...extraEnvFiles,
    process.env.AWLAD_ENV_FILE || '',
    path.join(rootDir, '.env'),
  ].filter(Boolean);

  for (const envPath of candidates) {
    try {
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath, override: false });
      }
    } catch {
      // Ignore unreadable optional .env candidate
    }
  }
}

export function getLanAddresses(activePort) {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net && net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips.map((ip) => ({ ip, url: `http://${ip}:${activePort}` }));
}

function listenWithFallback(httpServer, host, requestedPort, allowPortFallback) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (allowPortFallback && err?.code === 'EADDRINUSE' && requestedPort !== 0) {
        httpServer.removeListener('error', onError);
        httpServer.once('error', reject);
        httpServer.listen(0, host, () => resolve(httpServer.address().port));
        return;
      }
      reject(err);
    };
    httpServer.once('error', onError);
    httpServer.listen(requestedPort, host, () => {
      httpServer.removeListener('error', onError);
      resolve(httpServer.address().port);
    });
  });
}

export async function startStandaloneServer(options = {}) {
  loadEnvCandidates(options.envFiles || []);

  const requestedPort = Number(options.port ?? process.env.PORT ?? process.env.API_PORT ?? 3000);
  const host = options.host || '0.0.0.0';
  const distDir = options.distDir ? path.resolve(options.distDir) : path.join(rootDir, 'dist');
  const allowPortFallback = Boolean(options.allowPortFallback);

  await initializeServerRuntime();
  const app = createApiApp();

  app.use('/assets/aistudio', (_req, res) => {
    res.status(404).end();
  });

  if (fs.existsSync(distDir)) {
    const setNoCacheHeaders = (res) => {
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

  const httpServer = http.createServer(app);
  const activeSockets = new Set();
  httpServer.on('connection', (socket) => {
    activeSockets.add(socket);
    socket.on('close', () => activeSockets.delete(socket));
  });

  const activePort = await listenWithFallback(httpServer, host, requestedPort, allowPortFallback);
  process.env.AWLAD_ACTIVE_PORT = String(activePort);

  const lanUrls = getLanAddresses(activePort);
  const dataPaths = getDataPaths();
  console.log(`AWLAD SELIM Enterprise Server listening on http://${host}:${activePort} (data: ${dataPaths.dataDir})`);

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await flushJsonWrites();
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        for (const socket of activeSockets) {
          try {
            socket.destroy();
          } catch {
            // ignore
          }
        }
        resolve();
      }, 2500);
      httpServer.close(() => {
        clearTimeout(timeout);
        resolve();
      });
      if (typeof httpServer.closeIdleConnections === 'function') {
        httpServer.closeIdleConnections();
      }
    });
    await flushJsonWrites();
    await closePostgresPool();
  };

  return {
    app,
    httpServer,
    port: activePort,
    host,
    distDir,
    dataPaths,
    lanUrls,
    localUrl: `http://127.0.0.1:${activePort}`,
    close,
  };
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  let instance = null;
  startStandaloneServer()
    .then((srv) => {
      instance = srv;
    })
    .catch((err) => {
      console.error('[Standalone Server Error]:', err);
      process.exit(1);
    });

  const shutdown = async () => {
    if (instance) {
      await instance.close();
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

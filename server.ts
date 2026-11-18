import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiApp, initializeServerRuntime } from './server/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || process.env.API_PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startUnifiedServer() {
  await initializeServerRuntime();
  const app = createApiApp();
  const httpServer = http.createServer(app);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: {
          server: httpServer,
        },
        hmr: {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`AWLAD SELIM Server (${isProduction ? 'production' : 'development'}) listening on http://0.0.0.0:${port}`);
  });
}

startUnifiedServer().catch((err) => {
  console.error('[Server Startup Error]:', err);
  process.exit(1);
});

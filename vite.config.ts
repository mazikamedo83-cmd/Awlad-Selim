import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function excludeAiStudioAssetsPlugin(): Plugin {
  return {
    name: 'awlad-exclude-aistudio-assets',
    closeBundle() {
      const aistudioOut = path.resolve(__dirname, 'dist', 'assets', 'aistudio');
      if (fs.existsSync(aistudioOut)) {
        fs.rmSync(aistudioOut, { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), excludeAiStudioAssetsPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      allowedHosts: true as const,
      watch: {
        ignored: [
          '**/AWLAD_SELIM_BACKUP/**',
          '**/android/**',
          '**/ios/**',
          '**/dist/**',
          '**/dist-electron/**',
        ],
      },
    },
  };
});

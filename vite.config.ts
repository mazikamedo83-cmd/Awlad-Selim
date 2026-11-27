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
      for (const relPath of [
        ['dist', 'assets', 'aistudio'],
        ['dist', 'product-images'],
      ]) {
        const target = path.resolve(__dirname, ...relPath);
        if (fs.existsSync(target)) {
          fs.rmSync(target, { recursive: true, force: true });
        }
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

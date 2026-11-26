import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const WEB_PORT = Number(process.env.WEB_PORT ?? 6767);
const API_PORT = Number(process.env.API_PORT ?? 6768);

// Local development binds to loopback only. strictPort makes a port conflict fail
// loudly instead of silently moving to another port.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      // Use shared sources directly so edits hot-reload without a rebuild.
      '@flow/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      // EP01: the API serves its routes under /api (same paths as the dev gateway).
      '/api': { target: `http://127.0.0.1:${API_PORT}` },
    },
  },
  preview: { host: '127.0.0.1', port: WEB_PORT, strictPort: true },
  build: {
    // The gateway's font-src permits same-origin files. Keep font subsets out of data URLs.
    assetsInlineLimit: (filePath) => (/\.woff2?$/i.test(filePath) ? false : undefined),
    sourcemap: mode !== 'production',
    target: 'es2022',
  },
}));

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The built shell uses relative asset URLs (`./assets/…`). The CLI rewrites
// them to the configured base path when it serves or generates pages, so one
// build of the viewer works under any base.
const devBackend = process.env.SKILLARIUM_DEV_BACKEND ?? 'http://127.0.0.1:4400';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    // Never inline assets as data: URLs — the viewer's Content Security Policy
    // only allows fonts and scripts from its own origin.
    assetsInlineLimit: 0,
  },
  server: {
    // `pnpm --filter @skillarium/web dev` proxies data to a running `skillarium dev`.
    proxy: {
      '/data': devBackend,
      '/files': devBackend,
      '/__skillarium': devBackend,
    },
  },
});

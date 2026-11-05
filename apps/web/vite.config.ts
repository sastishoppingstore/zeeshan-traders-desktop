import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Desktop (Electron) differs from web for two reasons, and nothing else:
//   1. base './'  — Electron loads the app from file:///.../out/index.html, so absolute
//      '/assets/...' URLs would resolve to file:///assets/... and 404.
//   2. outDir <repoRoot>/out — electron-builder packs one self-contained folder that the
//      web/CDN pipeline never sees; apps/web/dist keeps serving the normal web build.
// Both are gated on BUILD_TARGET=desktop, so `npm run build:web` is byte-for-byte unchanged.
const isDesktop = process.env.BUILD_TARGET === 'desktop';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: isDesktop ? './' : '/',
  plugins: [react()],
  resolve: {
    alias: { '@zt/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  server: { host: '0.0.0.0', allowedHosts: true },
  build: {
    outDir: isDesktop ? fileURLToPath(new URL('../../out', import.meta.url)) : 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react';
          if (id.includes('node_modules/@tanstack')) return 'query';
          if (id.includes('node_modules/@simplewebauthn')) return 'authn';
          return undefined;
        },
      },
    },
  },
});

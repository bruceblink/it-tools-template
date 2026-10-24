import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import { createRendererDefines, createRendererPlugins } from './vite.plugins.js';

const projectRoot = import.meta.dirname;

const appProtocolBase = {
  name: 'electron-app-protocol-base',
  enforce: 'post' as const,
  config: () => ({ base: '/' }),
};

export default defineConfig({
  main: {
    build: {
      outDir: resolve(projectRoot, 'out/main'),
      lib: {
        entry: {
          main: resolve(projectRoot, 'electron/main.ts'),
          'database-worker': resolve(projectRoot, 'electron/database/worker.ts'),
          'system-monitor-worker': resolve(projectRoot, 'electron/system-monitor/worker.ts'),
        },
        formats: ['cjs'],
      },
    },
  },
  preload: {
    build: {
      outDir: resolve(projectRoot, 'out/preload'),
      lib: {
        entry: resolve(projectRoot, 'electron/preload.ts'),
        formats: ['cjs'],
        fileName: 'index.cjs',
      },
    },
  },
  renderer: {
    root: resolve(projectRoot, 'electron-renderer'),
    envDir: projectRoot,
    publicDir: resolve(projectRoot, 'public'),
    base: '/',
    worker: { format: 'es' },
    resolve: {
      alias: {
        '@': resolve(projectRoot, 'src'),
      },
    },
    define: {
      ...createRendererDefines({ desktop: true }),
      'import.meta.env.ELECTRON': 'true',
    },
    plugins: [...createRendererPlugins(), appProtocolBase],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    build: {
      outDir: resolve(projectRoot, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(projectRoot, 'electron-renderer/index.html'),
      },
    },
  },
});

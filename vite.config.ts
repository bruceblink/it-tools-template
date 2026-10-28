import { resolve } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { configDefaults } from 'vitest/config';
import { filterAppShell, runtimeAssetsPlugin } from './scripts/pwa-cache.mjs';
import { createRendererDefines, createRendererPlugins } from './vite.plugins.js';

const baseUrl = process.env.BASE_URL ?? '/';

export default defineConfig(({ command }) => ({
  plugins: [
    ...createRendererPlugins({ componentDeclarations: command === 'serve' }),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeManifestIcons: false,
      injectManifest: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2,ttf,otf,wasm,webmanifest}'],
      },
      integration: {
        configureOptions(viteConfig, options) {
          const directory = resolve(viteConfig.root, viteConfig.build.outDir);
          const additionalEntries: import('workbox-build').ManifestEntry[] = [];
          options.injectManifest = {
            ...options.injectManifest,
            additionalManifestEntries: additionalEntries,
            manifestTransforms: [entries => filterAppShell(directory, entries, additionalEntries)],
            plugins: [runtimeAssetsPlugin(directory)],
          };
        },
      },
      manifest: {
        name: 'IT Tools',
        description: 'Aggregated set of useful tools for developers.',
        display: 'standalone',
        lang: 'fr-FR',
        start_url: `${baseUrl}?utm_source=pwa&utm_medium=pwa`,
        orientation: 'any',
        theme_color: '#18a058',
        background_color: '#f1f5f9',
        icons: [
          { src: '/favicon-16x16.png', type: 'image/png', sizes: '16x16' },
          { src: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
          { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  base: baseUrl,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: createRendererDefines(),
  worker: { format: 'es' },
  test: {
    exclude: [...configDefaults.exclude, '**/*.e2e.spec.ts', 'scripts/**/*.test.mjs'],
    server: { deps: { inline: ['iarna-toml-esm'] } },
  },
  build: {
    target: 'esnext',
    manifest: true,
    // The Rolldown shared-vendor graph currently promotes dependencies of lazy
    // tool routes to modulepreload links in index.html. That makes the home
    // page request most of the tool graph before the user clicks anything and
    // can starve route navigation on slower edge connections. Route chunks are
    // still loaded by their dynamic imports when a tool is opened.
    modulePreload: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'shared-vendor',
              test: /[\\/]node_modules[\\/]/,
              minShareCount: 2,
              entriesAware: true,
              entriesAwareMergeThreshold: 0,
            },
          ],
        },
      },
    },
  },
}));

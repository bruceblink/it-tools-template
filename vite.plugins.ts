import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import VueI18n from '@intlify/unplugin-vue-i18n/vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import Unocss from 'unocss/vite';
import AutoImport from 'unplugin-auto-import/vite';
import IconsResolver from 'unplugin-icons/resolver';
import Icons from 'unplugin-icons/vite';
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';
import markdown from 'unplugin-vue-markdown/vite';
import svgLoader from 'vite-svg-loader';
import pkg from './package.json';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export function createRendererPlugins() {
  return [
    VueI18n({
      runtimeOnly: true,
      compositionOnly: true,
      fullInstall: true,
      strictMessage: false,
      include: [resolve(projectRoot, 'locales/**')],
    }),
    AutoImport({
      // Declarations are regenerated locally before typechecking and stay out of Git.
      dts: resolve(projectRoot, 'auto-imports.d.ts'),
      dtsMode: 'overwrite',
      imports: [
        'vue',
        'vue-router',
        '@vueuse/core',
        'vue-i18n',
        {
          'naive-ui': ['useDialog', 'useMessage', 'useNotification', 'useLoadingBar'],
        },
      ],
      vueTemplate: true,
      eslintrc: {
        enabled: true,
      },
    }),
    Icons({ compiler: 'vue3' }),
    vue({
      include: [/\.vue$/, /\.md$/],
    }),
    vueJsx(),
    markdown({}),
    svgLoader(),
    Components({
      dirs: [resolve(projectRoot, 'src')],
      dts: resolve(projectRoot, 'components.d.ts'),
      dtsTsx: false,
      extensions: ['vue', 'md'],
      include: [/\.vue$/, /\.vue\?vue/, /\.md$/],
      resolvers: [NaiveUiResolver(), IconsResolver({ prefix: 'icon' })],
    }),
    Unocss(),
  ];
}

export function createRendererDefines({ desktop = false }: { desktop?: boolean } = {}) {
  return {
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(pkg.version),
    'import.meta.env.AUTHOR_URL': JSON.stringify(pkg.authorUrl),
    'import.meta.env.SPONSORING_URL': JSON.stringify(pkg.sponsoringUrl),
    'import.meta.env.REPOSITORY_URL': JSON.stringify(pkg.repository.url),
    ...(desktop
      ? { 'import.meta.env.VITE_VERCEL_ENV': JSON.stringify('production') }
      : {}),
  };
}

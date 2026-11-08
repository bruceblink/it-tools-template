/// <reference types="vite/client" />
/// <reference types="vite-svg-loader" />

declare module 'virtual:pwa-runtime-assets' {
  export const assetPaths: string[];
  export const buildId: string;
}

interface ImportMetaEnv {
  VITE_PLAUSIBLE_API_HOST: string;
  VITE_PLAUSIBLE_DOMAIN: string;
  VITE_PLUGIN_MARKETPLACE_API_BASE?: string;
  VITE_PLUGIN_MARKETPLACE_TOPIC?: string;
  VITE_PLUGIN_MARKETPLACE_OWNER?: string;
  PACKAGE_VERSION: string;
  AUTHOR_URL: string;
  SPONSORING_URL: string;
  REPOSITORY_URL: string;
  GIT_SHORT_SHA: string;
  PROD: boolean;
  ELECTRON: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

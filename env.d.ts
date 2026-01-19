/// <reference types="vite/client" />
/// <reference types="vite-svg-loader" />

interface ImportMetaEnv {
  VITE_PLAUSIBLE_API_HOST: string;
  VITE_PLAUSIBLE_DOMAIN: string;
  PACKAGE_VERSION: string;
  AUTHOR_URL: string;
  SPONSORING_URL: string;
  REPOSITORY_URL: string;
  GIT_SHORT_SHA: string;
  PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

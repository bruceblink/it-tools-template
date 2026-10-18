import { mountSharedApp } from './app';

void mountSharedApp()
  .catch((error: unknown) => {
    console.error('[app] Failed to mount the shared interface.', error);
  })
  .finally(() => {
    window.setTimeout(() => {
      void import('virtual:pwa-register')
        .then(({ registerSW }) => registerSW())
        .catch((error: unknown) => {
          console.warn('[pwa] Failed to load the service worker registration helper.', error);
        });
    }, 0);
  });

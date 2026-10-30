import { mountSharedApp } from './app';

const serviceWorkerRegistrationDelayMs = 8_000;

function scheduleServiceWorkerRegistration() {
  if (import.meta.env.ELECTRON) {
    return;
  }

  // Let the first user navigation finish before the PWA shell starts fetching
  // its precache entries. The service worker remains available for later visits.
  window.setTimeout(() => {
    void import('virtual:pwa-register')
      .then(({ registerSW }) => registerSW())
      .catch((error: unknown) => {
        console.warn('[pwa] Failed to load the service worker registration helper.', error);
      });
  }, serviceWorkerRegistrationDelayMs);
}

void mountSharedApp()
  .catch((error: unknown) => {
    console.error('[app] Failed to mount the shared interface.', error);
  })
  .finally(scheduleServiceWorkerRegistration);

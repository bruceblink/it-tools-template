import { ref } from 'vue';
import type { RegisterSWOptions } from 'virtual:pwa-register';

export const webUpdateReady = ref(false);
let applyUpdate: (() => Promise<void>) | undefined;

export function registerWebUpdates(registerSW: (options?: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>) {
  let registration: ServiceWorkerRegistration | undefined;
  const check = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      void registration?.update().catch(error => console.warn('[pwa] Update check failed.', error));
    }
  };
  registerSW({
    onNeedRefresh: () => { webUpdateReady.value = true; },
    onNeedReload: () => {
      webUpdateReady.value = true;
    },
    onRegisteredSW: (_url, value) => {
      registration = value;
      check();
    },
    onRegisterError: error => console.warn('[pwa] Service worker registration failed.', error),
  });
  applyUpdate = async () => {
    const waiting = registration?.waiting;
    if (!waiting) {
      window.location.reload();
      return;
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    waiting.postMessage({ type: 'SKIP_WAITING' });
  };
  window.setInterval(check, 60 * 60 * 1000);
  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', check);
}

export async function applyWebUpdate() {
  await applyUpdate?.();
}

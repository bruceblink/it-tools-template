import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createHead } from '@unhead/vue/client';
import shadow from 'vue-shadow-dom';
import { plausible } from './plugins/plausible.plugin';
import { naive } from './plugins/naive.plugin';

import 'virtual:uno.css';

import App from './App.vue';
import router, { registerDemoRoutes } from './router';
import { activateLocale, i18nPlugin, type SupportedLocale } from './plugins/i18n.plugin';
import { tools } from './tools';
import { prefetchToolsWhenIdle } from './tools/tool-prefetch';

function readSavedLocale() {
  try {
    return window.localStorage.getItem('locale') ?? 'en';
  }
  catch {
    return 'en';
  }
}

function saveLocale(locale: string) {
  try {
    window.localStorage.setItem('locale', locale);
  }
  catch {
    // Storage can be unavailable in restricted browser contexts; the active language still works.
  }
}

export async function mountSharedApp() {
  await registerDemoRoutes();
  const app = createApp(App);

  app.use(createPinia());
  app.use(createHead());
  app.use(i18nPlugin);
  app.use(router);
  app.use(naive);
  app.use(plausible);
  app.use(shadow);

  let activeLocale: SupportedLocale;
  try {
    activeLocale = await activateLocale(readSavedLocale());
  }
  catch (error) {
    console.warn('[i18n] Could not load the saved language. Using English.', error);
    activeLocale = await activateLocale('en');
  }
  saveLocale(activeLocale);

  app.mount('#app');
  prefetchToolsWhenIdle(tools);
}

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createHead } from '@vueuse/head';
import shadow from 'vue-shadow-dom';
import { plausible } from './plugins/plausible.plugin';
import { naive } from './plugins/naive.plugin';

import 'virtual:uno.css';

import App from './App.vue';
import router from './router';
import { i18nPlugin } from './plugins/i18n.plugin';

export function mountSharedApp() {
  const app = createApp(App);

  app.use(createPinia());
  app.use(createHead());
  app.use(i18nPlugin);
  app.use(router);
  app.use(naive);
  app.use(plausible);
  app.use(shadow);

  app.mount('#app');
}

import { createRouter, createWebHistory } from 'vue-router';
import HomePage from './pages/Home.page.vue';
import NotFound from './pages/404.page.vue';
import { tools } from './tools';
import { config } from './config';
import { layouts } from '@/layouts';

const toolsRoutes = tools.map(({ path, name, component, translationKey, description, keywords, contentWidth, extensionOwned }) => ({
  path,
  name,
  component,
  meta: {
    isTool: true,
    layout: layouts.toolLayout,
    name,
    translationKey,
    description,
    keywords,
    ...(contentWidth ? { contentWidth } : {}),
    ...(extensionOwned ? { extensionOwned: true } : {}),
  },
}));
const toolsRedirectRoutes = tools.flatMap(({ path, aliases, redirectFrom }) =>
  (aliases ?? redirectFrom ?? []).map(alias => ({ path: alias, redirect: path })),
);

const router = createRouter({
  history: createWebHistory(config.app.baseUrl),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomePage,
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('./pages/About.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./pages/Settings.page.vue'),
    },
    {
      path: '/settings/extensions',
      redirect: { name: 'settings' },
    },
    ...toolsRoutes,
    ...toolsRedirectRoutes,
    { path: '/:pathMatch(.*)*', name: 'NotFound', component: NotFound },
  ],
});

/** Register component demos only in development builds, outside the production route graph. */
export async function registerDemoRoutes() {
  if (!import.meta.env.DEV) {
    return;
  }
  const { routes } = await import('./ui/demo/demo.routes');
  routes.forEach(route => router.addRoute(route));
}

router.beforeEach(async (to) => {
  if (to.meta.extensionOwned === true) {
    const { activateExtensionToolRoute } = await import('./extensions/route-activation-runtime');
    await activateExtensionToolRoute(to.path);
  }
  return true;
});

export default router;

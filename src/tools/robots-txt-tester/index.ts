import { Robot } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.robots-txt-tester.title'),
  path: '/robots-txt-tester',
  description: translate('tools.robots-txt-tester.description'),
  keywords: ['robots', 'robots.txt', 'crawler', 'seo', 'user-agent', 'sitemap', 'crawl-delay'],
  component: () => import('./robots-txt-tester.vue'),
  icon: Robot,
  createdAt: new Date('2026-07-04'),
});

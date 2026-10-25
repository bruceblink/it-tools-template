import { Robot } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/robots-txt-tester',
  categoryId: 'web',
  translationKey: 'robots-txt-tester',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.robots-txt-tester.title'),
  path: '/robots-txt-tester',
  description: translate('tools.robots-txt-tester.description'),
  keywords: ['robots', 'robots.txt', 'crawler', 'seo', 'user-agent', 'sitemap', 'crawl-delay'],
  component: () => loadBuiltinToolComponent('robots-txt-tester/robots-txt-tester.vue'),
  icon: Robot,
  createdAt: new Date('2026-07-04'),
});

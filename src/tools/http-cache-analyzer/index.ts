import { Clock } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.http-cache-analyzer.title'),
  path: '/http-cache-analyzer',
  description: translate('tools.http-cache-analyzer.description'),
  keywords: ['http', 'cache', 'headers', 'cache-control', 'etag', 'expires', 'date', 'age', 'freshness', 'vary'],
  component: () => import('./http-cache-analyzer.vue'),
  icon: Clock,
  createdAt: new Date('2026-07-04'),
});

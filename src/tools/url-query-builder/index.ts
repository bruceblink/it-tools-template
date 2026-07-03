import { Link } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.url-query-builder.title'),
  path: '/url-query-builder',
  description: translate('tools.url-query-builder.description'),
  keywords: ['url', 'query', 'parameters', 'builder', 'preview', 'duplicate', 'json'],
  component: () => import('./url-query-builder.vue'),
  icon: Link,
  createdAt: new Date('2026-06-08'),
});

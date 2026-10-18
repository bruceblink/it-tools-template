import { Link } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/url-query-builder',
  categoryId: 'web',
  translationKey: 'url-query-builder',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.url-query-builder.title'),
  path: '/url-query-builder',
  description: translate('tools.url-query-builder.description'),
  keywords: ['url', 'query', 'parameters', 'builder', 'preview', 'duplicate', 'json'],
  component: () => import('./url-query-builder.vue'),
  icon: Link,
  createdAt: new Date('2026-06-08'),
});

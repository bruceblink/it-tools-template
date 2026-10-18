import { Link } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/url-encoder',
  categoryId: 'web',
  translationKey: 'url-encoder',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.url-encoder.title'),
  path: '/url-encoder',
  description: translate('tools.url-encoder.description'),
  keywords: ['url', 'encode', 'decode', 'percent', '%20', 'format'],
  component: () => import('./url-encoder.vue'),
  icon: Link,
});

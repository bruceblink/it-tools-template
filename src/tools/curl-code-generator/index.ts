import { Terminal2 } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.curl-code-generator.title'),
  path: '/curl-code-generator',
  description: translate('tools.curl-code-generator.description'),
  keywords: ['curl', 'fetch', 'axios', 'httpie', 'http', 'request', 'api', 'code', 'generator'],
  component: () => import('./curl-code-generator.vue'),
  icon: Terminal2,
  createdAt: new Date('2026-07-04'),
});

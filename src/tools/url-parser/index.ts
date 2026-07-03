import { Unlink } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.url-parser.title'),
  path: '/url-parser',
  description: translate('tools.url-parser.description'),
  keywords: ['url', 'parser', 'protocol', 'origin', 'params', 'query', 'duplicate', 'port', 'username', 'password', 'credentials', 'href', 'summary', 'segments'],
  component: () => import('./url-parser.vue'),
  icon: Unlink,
});

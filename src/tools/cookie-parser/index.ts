import { Cookie } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.cookie-parser.title'),
  path: '/cookie-parser',
  description: translate('tools.cookie-parser.description'),
  keywords: ['cookie', 'cookies', 'set-cookie', 'http', 'headers', 'secure', 'httponly', 'samesite'],
  component: () => import('./cookie-parser.vue'),
  icon: Cookie,
  createdAt: new Date('2026-07-04'),
});

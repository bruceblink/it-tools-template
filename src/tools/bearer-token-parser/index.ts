import { Key } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.bearer-token-parser.title'),
  path: '/bearer-token-parser',
  description: translate('tools.bearer-token-parser.description'),
  keywords: ['bearer', 'token', 'authorization', 'jwt', 'oauth', 'api', 'auth', 'exp', 'nbf', 'expiry', 'scope', 'audience', 'roles', 'issuer', 'subject'],
  component: () => import('./bearer-token-parser.vue'),
  icon: Key,
  createdAt: new Date('2026-07-04'),
});

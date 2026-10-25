import { Key } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/bearer-token-parser',
  categoryId: 'web',
  translationKey: 'bearer-token-parser',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.bearer-token-parser.title'),
  path: '/bearer-token-parser',
  description: translate('tools.bearer-token-parser.description'),
  keywords: ['bearer', 'token', 'authorization', 'jwt', 'oauth', 'api', 'auth', 'exp', 'nbf', 'expiry', 'scope', 'audience', 'roles', 'issuer', 'subject'],
  component: () => loadBuiltinToolComponent('bearer-token-parser/bearer-token-parser.vue'),
  icon: Key,
  createdAt: new Date('2026-07-04'),
});

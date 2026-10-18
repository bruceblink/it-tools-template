import { Key } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/jwt-parser',
  categoryId: 'web',
  translationKey: 'jwt-parser',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  name: translate('tools.jwt-parser.title'),
  path: '/jwt-parser',
  description: translate('tools.jwt-parser.description'),
  keywords: [
    'jwt',
    'parser',
    'decode',
    'typ',
    'alg',
    'iss',
    'sub',
    'aud',
    'exp',
    'nbf',
    'iat',
    'jti',
    'json',
    'web',
    'token',
  ],
  component: () => import('./jwt-parser.vue'),
  icon: Key,
});

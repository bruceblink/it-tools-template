import { ShortTextRound } from '@vicons/material';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/hmac-generator',
  categoryId: 'crypto',
  translationKey: 'hmac-generator',
  name: translate('tools.hmac-generator.title'),
  path: '/hmac-generator',
  description: translate('tools.hmac-generator.description'),
  keywords: ['hmac', 'generator', 'secret', 'signature', 'MD5', 'SHA1', 'SHA256', 'SHA224', 'SHA512', 'SHA384', 'SHA3', 'RIPEMD160'],
  component: () => import('./hmac-generator.vue'),
  icon: ShortTextRound,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
});

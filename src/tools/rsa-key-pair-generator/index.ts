import { Certificate } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/rsa-key-pair-generator',
  categoryId: 'crypto',
  translationKey: 'rsa-key-pair-generator',
  name: translate('tools.rsa-key-pair-generator.title'),
  path: '/rsa-key-pair-generator',
  description: translate('tools.rsa-key-pair-generator.description'),
  keywords: ['rsa', 'key', 'pair', 'generator', 'public', 'private', 'secret', 'ssh', 'pem'],
  component: () => import('./rsa-key-pair-generator.vue'),
  icon: Certificate,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
});

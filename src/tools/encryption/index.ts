import { Lock } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/encryption',
  categoryId: 'crypto',
  translationKey: 'encryption',
  name: translate('tools.encryption.title'),
  path: '/encryption',
  description: translate('tools.encryption.description'),
  keywords: ['cypher', 'encipher', 'text', 'AES', 'TripleDES', 'Rabbit', 'RC4'],
  component: () => import('./encryption.vue'),
  icon: Lock,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  redirectFrom: ['/cypher'],
});

import { Binary } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/ipv4-address-converter',
  categoryId: 'network',
  translationKey: 'ipv4-address-converter',
  name: translate('tools.ipv4-address-converter.title'),
  path: '/ipv4-address-converter',
  description: translate('tools.ipv4-address-converter.description'),
  keywords: ['ipv4', 'address', 'converter', 'decimal', 'hexadecimal', 'binary', 'ipv6'],
  component: () => import('./ipv4-address-converter.vue'),
  icon: Binary,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2023-04-08'),
});

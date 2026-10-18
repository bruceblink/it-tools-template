import { BuildingFactory } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/ipv6-ula-generator',
  categoryId: 'network',
  translationKey: 'ipv6-ula-generator',
  name: translate('tools.ipv6-ula-generator.title'),
  path: '/ipv6-ula-generator',
  description: translate('tools.ipv6-ula-generator.description'),
  keywords: ['ipv6', 'ula', 'generator', 'rfc4193', 'network', 'private'],
  component: () => import('./ipv6-ula-generator.vue'),
  icon: BuildingFactory,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2023-04-09'),
});

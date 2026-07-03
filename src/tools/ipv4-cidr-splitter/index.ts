import { ArrowsSplit } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.ipv4-cidr-splitter.title'),
  path: '/ipv4-cidr-splitter',
  description: translate('tools.ipv4-cidr-splitter.description'),
  keywords: ['ipv4', 'cidr', 'split', 'subnet', 'network', 'vlan', 'range'],
  component: () => import('./ipv4-cidr-splitter.vue'),
  icon: ArrowsSplit,
  createdAt: new Date('2026-07-03'),
});

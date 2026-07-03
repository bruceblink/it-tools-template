import { ArrowsCross } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.ipv4-cidr-overlap-checker.title'),
  path: '/ipv4-cidr-overlap-checker',
  description: translate('tools.ipv4-cidr-overlap-checker.description'),
  keywords: ['ipv4', 'cidr', 'overlap', 'conflict', 'subnet', 'network', 'range'],
  component: () => import('./ipv4-cidr-overlap-checker.vue'),
  icon: ArrowsCross,
  createdAt: new Date('2026-07-04'),
});

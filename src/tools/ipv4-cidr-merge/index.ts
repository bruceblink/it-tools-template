import { GitMerge } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.ipv4-cidr-merge.title'),
  path: '/ipv4-cidr-merge',
  description: translate('tools.ipv4-cidr-merge.description'),
  keywords: ['ipv4', 'cidr', 'merge', 'collapse', 'range', 'subnet', 'network'],
  component: () => import('./ipv4-cidr-merge.vue'),
  icon: GitMerge,
  createdAt: new Date('2026-07-03'),
});

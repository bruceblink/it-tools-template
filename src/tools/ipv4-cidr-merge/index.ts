import { GitMerge } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/ipv4-cidr-merge',
  categoryId: 'network',
  translationKey: 'ipv4-cidr-merge',
  name: translate('tools.ipv4-cidr-merge.title'),
  path: '/ipv4-cidr-merge',
  description: translate('tools.ipv4-cidr-merge.description'),
  keywords: ['ipv4', 'cidr', 'merge', 'collapse', 'range', 'subnet', 'network'],
  component: () => loadBuiltinToolComponent('ipv4-cidr-merge/ipv4-cidr-merge.vue'),
  icon: GitMerge,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2026-07-03'),
});

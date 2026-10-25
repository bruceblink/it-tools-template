import { ArrowsSplit } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/ipv4-cidr-splitter',
  categoryId: 'network',
  translationKey: 'ipv4-cidr-splitter',
  name: translate('tools.ipv4-cidr-splitter.title'),
  path: '/ipv4-cidr-splitter',
  description: translate('tools.ipv4-cidr-splitter.description'),
  keywords: ['ipv4', 'cidr', 'split', 'subnet', 'network', 'vlan', 'range'],
  component: () => loadBuiltinToolComponent('ipv4-cidr-splitter/ipv4-cidr-splitter.vue'),
  icon: ArrowsSplit,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2026-07-03'),
});

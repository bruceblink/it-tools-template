import { ArrowsCross } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/ipv4-cidr-overlap-checker',
  categoryId: 'network',
  translationKey: 'ipv4-cidr-overlap-checker',
  name: translate('tools.ipv4-cidr-overlap-checker.title'),
  path: '/ipv4-cidr-overlap-checker',
  description: translate('tools.ipv4-cidr-overlap-checker.description'),
  keywords: ['ipv4', 'cidr', 'overlap', 'conflict', 'subnet', 'network', 'range'],
  component: () => loadBuiltinToolComponent('ipv4-cidr-overlap-checker/ipv4-cidr-overlap-checker.vue'),
  icon: ArrowsCross,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2026-07-04'),
});

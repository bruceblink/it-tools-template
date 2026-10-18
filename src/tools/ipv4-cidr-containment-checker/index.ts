import { GitCompare } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/ipv4-cidr-containment-checker',
  categoryId: 'network',
  translationKey: 'ipv4-cidr-containment-checker',
  name: translate('tools.ipv4-cidr-containment-checker.title'),
  path: '/ipv4-cidr-containment-checker',
  description: translate('tools.ipv4-cidr-containment-checker.description'),
  keywords: ['ipv4', 'cidr', 'containment', 'contains', 'allowlist', 'route', 'subnet', 'network'],
  component: () => import('./ipv4-cidr-containment-checker.vue'),
  icon: GitCompare,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2026-07-04'),
});

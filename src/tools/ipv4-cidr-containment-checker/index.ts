import { GitCompare } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.ipv4-cidr-containment-checker.title'),
  path: '/ipv4-cidr-containment-checker',
  description: translate('tools.ipv4-cidr-containment-checker.description'),
  keywords: ['ipv4', 'cidr', 'containment', 'contains', 'allowlist', 'route', 'subnet', 'network'],
  component: () => import('./ipv4-cidr-containment-checker.vue'),
  icon: GitCompare,
  createdAt: new Date('2026-07-04'),
});

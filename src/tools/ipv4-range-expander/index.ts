import { UnfoldMoreOutlined } from '@vicons/material';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/ipv4-range-expander',
  categoryId: 'network',
  translationKey: 'ipv4-range-expander',
  name: translate('tools.ipv4-range-expander.title'),
  path: '/ipv4-range-expander',
  description: translate('tools.ipv4-range-expander.description'),
  keywords: ['ipv4', 'range', 'expander', 'subnet', 'creator', 'cidr'],
  component: () => import('./ipv4-range-expander.vue'),
  icon: UnfoldMoreOutlined,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2023-04-19'),
});

import { RouterOutlined } from '@vicons/material';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/ipv4-subnet-calculator',
  categoryId: 'network',
  translationKey: 'ipv4-subnet-calculator',
  name: translate('tools.ipv4-subnet-calculator.title'),
  path: '/ipv4-subnet-calculator',
  description: translate('tools.ipv4-subnet-calculator.description'),
  keywords: ['ipv4', 'subnet', 'calculator', 'mask', 'network', 'cidr', 'netmask', 'bitmask', 'broadcast', 'address'],
  component: () => import('./ipv4-subnet-calculator.vue'),
  icon: RouterOutlined,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
});

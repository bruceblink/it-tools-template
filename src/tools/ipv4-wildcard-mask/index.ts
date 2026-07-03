import { Sitemap } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.ipv4-wildcard-mask.title'),
  path: '/ipv4-wildcard-mask',
  description: translate('tools.ipv4-wildcard-mask.description'),
  keywords: ['ipv4', 'wildcard', 'mask', 'acl', 'cisco', 'subnet', 'network', 'cidr'],
  component: () => import('./ipv4-wildcard-mask.vue'),
  icon: Sitemap,
  createdAt: new Date('2026-07-03'),
});

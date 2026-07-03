import { Sitemap } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.ipv4-address-classifier.title'),
  path: '/ipv4-address-classifier',
  description: translate('tools.ipv4-address-classifier.description'),
  keywords: ['ipv4', 'address', 'classifier', 'private', 'public', 'loopback', 'reserved', 'network'],
  component: () => import('./ipv4-address-classifier.vue'),
  icon: Sitemap,
  createdAt: new Date('2026-07-03'),
});

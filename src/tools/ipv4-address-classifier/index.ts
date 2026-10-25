import { Sitemap } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/ipv4-address-classifier',
  categoryId: 'network',
  translationKey: 'ipv4-address-classifier',
  name: translate('tools.ipv4-address-classifier.title'),
  path: '/ipv4-address-classifier',
  description: translate('tools.ipv4-address-classifier.description'),
  keywords: ['ipv4', 'address', 'classifier', 'private', 'public', 'loopback', 'reserved', 'network'],
  component: () => loadBuiltinToolComponent('ipv4-address-classifier/ipv4-address-classifier.vue'),
  icon: Sitemap,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2026-07-03'),
});

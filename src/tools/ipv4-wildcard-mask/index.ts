import { Sitemap } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/ipv4-wildcard-mask',
  categoryId: 'network',
  translationKey: 'ipv4-wildcard-mask',
  name: translate('tools.ipv4-wildcard-mask.title'),
  path: '/ipv4-wildcard-mask',
  description: translate('tools.ipv4-wildcard-mask.description'),
  keywords: ['ipv4', 'wildcard', 'mask', 'acl', 'cisco', 'subnet', 'network', 'cidr'],
  component: () => loadBuiltinToolComponent('ipv4-wildcard-mask/ipv4-wildcard-mask.vue'),
  icon: Sitemap,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2026-07-03'),
});

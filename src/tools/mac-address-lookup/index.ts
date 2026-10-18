import { Devices } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/mac-address-lookup',
  extensionOwned: true,
  categoryId: 'network',
  translationKey: 'mac-address-lookup',
  name: translate('tools.mac-address-lookup.title'),
  path: '/mac-address-lookup',
  description: translate('tools.mac-address-lookup.description'),
  keywords: ['mac', 'address', 'lookup', 'vendor', 'parser', 'manufacturer'],
  component: () => import('./mac-address-lookup.vue'),
  icon: Devices,
  platforms: ['web', 'electron'],
  dataProcessing: 'local-data',
  offline: 'conditional',
  capabilities: ['data.oui'],
  createdAt: new Date('2023-04-06'),
});

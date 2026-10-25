import { Devices } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/mac-address-generator',
  categoryId: 'network',
  translationKey: 'mac-address-generator',
  name: translate('tools.mac-address-generator.title'),
  path: '/mac-address-generator',
  description: translate('tools.mac-address-generator.description'),
  keywords: ['mac', 'address', 'generator', 'random', 'prefix', 'oui', 'vendor', 'summary'],
  component: () => loadBuiltinToolComponent('mac-address-generator/mac-address-generator.vue'),
  icon: Devices,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2023-11-31'),
});

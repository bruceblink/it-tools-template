import { DeviceDesktop } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/object-storage',
  categoryId: 'development',
  translationKey: 'object-storage',
  name: translate('tools.object-storage.title'),
  path: '/object-storage',
  description: translate('tools.object-storage.description'),
  keywords: ['s3', 'bucket', 'object', 'storage'],
  component: () => loadBuiltinToolComponent('object-storage/object-storage.vue'),
  icon: DeviceDesktop,
  platforms: ['electron'],
  dataProcessing: 'network',
  offline: 'requires-network',
  capabilities: [],
  contentWidth: 'wide',
});

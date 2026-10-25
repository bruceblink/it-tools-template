import { DeviceDesktop } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/device-information',
  categoryId: 'web',
  translationKey: 'device-information',
  name: translate('tools.device-information.title'),
  path: '/device-information',
  description: translate('tools.device-information.description'),
  keywords: [
    'device',
    'information',
    'screen',
    'pixel',
    'ratio',
    'status',
    'data',
    'computer',
    'size',
    'user',
    'agent',
  ],
  component: () => loadBuiltinToolComponent('device-information/device-information.vue'),
  icon: DeviceDesktop,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['runtime.info'],
});

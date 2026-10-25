import { DeviceDesktop } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/system-monitor',
  categoryId: 'development',
  translationKey: 'system-monitor',
  name: translate('tools.system-monitor.title'),
  path: '/system-monitor',
  description: translate('tools.system-monitor.description'),
  keywords: ['system', 'monitor', 'cpu', 'memory', 'disk', 'network', 'process'],
  component: () => loadBuiltinToolComponent('system-monitor/system-monitor.vue'),
  icon: DeviceDesktop,
  platforms: ['electron'],
  dataProcessing: 'local-data',
  offline: 'available',
  capabilities: [],
  contentWidth: 'wide',
});

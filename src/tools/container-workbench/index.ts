import { DeviceDesktop } from '@vicons/tabler';
import { translate } from '@/plugins/i18n.plugin';
import { defineTool } from '../tool';

export const tool = defineTool({
  id: 'builtin/container-workbench',
  categoryId: 'development',
  translationKey: 'container-workbench',
  name: translate('tools.container-workbench.title'),
  path: '/container-workbench',
  description: translate('tools.container-workbench.description'),
  keywords: ['docker', 'container'],
  component: () => import('./container-workbench.vue'),
  icon: DeviceDesktop,
  platforms: ['electron'],
  dataProcessing: 'local-data',
  offline: 'conditional',
  capabilities: [],
  contentWidth: 'wide',
});

import { DeviceDesktop } from '@vicons/tabler';
import { translate } from '@/plugins/i18n.plugin';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';

export const tool = defineTool({
  id: 'builtin/git-workbench',
  categoryId: 'development',
  translationKey: 'git-workbench',
  name: translate('tools.git-workbench.title'),
  path: '/git-workbench',
  description: translate('tools.git-workbench.description'),
  keywords: ['git'],
  component: () => loadBuiltinToolComponent('git-workbench/git-workbench.vue'),
  icon: DeviceDesktop,
  platforms: ['electron'],
  dataProcessing: 'local-data',
  offline: 'available',
  capabilities: [],
  contentWidth: 'wide',
});

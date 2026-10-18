import { World } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/mime-types',
  extensionOwned: true,
  categoryId: 'web',
  translationKey: 'mime-types',
  platforms: ['web', 'electron'],
  dataProcessing: 'local-data',
  offline: 'available',
  capabilities: [],
  name: translate('tools.mime-types.title'),
  path: '/mime-types',
  description: translate('tools.mime-types.description'),
  keywords: ['mime', 'types', 'extension', 'content', 'type'],
  component: () => import('./mime-types.vue'),
  icon: World,
});

import { List } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/list-converter',
  categoryId: 'converter',
  translationKey: 'list-converter',
  name: translate('tools.list-converter.title'),
  path: '/list-converter',
  description: translate('tools.list-converter.description'),
  keywords: ['list', 'converter', 'sort', 'reverse', 'prefix', 'suffix', 'lowercase', 'truncate'],
  component: () => import('./list-converter.vue'),
  icon: List,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2023-05-07'),
});

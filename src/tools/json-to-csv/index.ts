import { List } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/json-to-csv',
  extensionOwned: true,
  categoryId: 'development',
  translationKey: 'json-to-csv',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  name: translate('tools.json-to-csv.title'),
  path: '/json-to-csv',
  description: translate('tools.json-to-csv.description'),
  keywords: ['json', 'to', 'csv', 'convert'],
  component: () => import('./json-to-csv.vue'),
  icon: List,
  createdAt: new Date('2023-06-18'),
});

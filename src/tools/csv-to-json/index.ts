import { List } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.csv-to-json.title'),
  path: '/csv-to-json',
  description: translate('tools.csv-to-json.description'),
  keywords: ['csv', 'json', 'convert', 'parse'],
  component: () => import('./csv-to-json.vue'),
  icon: List,
  createdAt: new Date('2026-06-08'),
});

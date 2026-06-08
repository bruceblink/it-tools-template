import { Table } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.csv-to-markdown-table.title'),
  path: '/csv-to-markdown-table',
  description: translate('tools.csv-to-markdown-table.description'),
  keywords: ['csv', 'markdown', 'table', 'convert'],
  component: () => import('./csv-to-markdown-table.vue'),
  icon: Table,
  createdAt: new Date('2026-06-08'),
});

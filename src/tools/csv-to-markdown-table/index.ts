import { Table } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/csv-to-markdown-table',
  categoryId: 'development',
  translationKey: 'csv-to-markdown-table',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  name: translate('tools.csv-to-markdown-table.title'),
  path: '/csv-to-markdown-table',
  description: translate('tools.csv-to-markdown-table.description'),
  keywords: ['csv', 'markdown', 'table', 'convert'],
  component: () => import('./csv-to-markdown-table.vue'),
  icon: Table,
  createdAt: new Date('2026-06-08'),
});

import { FileCode } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.json-lines-converter.title'),
  path: '/json-lines-converter',
  description: translate('tools.json-lines-converter.description'),
  keywords: ['json', 'jsonl', 'json lines', 'ndjson', 'newline delimited json'],
  component: () => import('./json-lines-converter.vue'),
  icon: FileCode,
  createdAt: new Date('2026-07-03'),
});

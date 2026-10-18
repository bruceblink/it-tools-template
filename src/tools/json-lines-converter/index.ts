import { FileCode } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/json-lines-converter',
  extensionOwned: true,
  categoryId: 'development',
  translationKey: 'json-lines-converter',
  name: translate('tools.json-lines-converter.title'),
  path: '/json-lines-converter',
  description: translate('tools.json-lines-converter.description'),
  keywords: ['json', 'jsonl', 'json lines', 'ndjson', 'newline delimited json'],
  component: () => import('./json-lines-converter.vue'),
  icon: FileCode,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2026-07-03'),
});

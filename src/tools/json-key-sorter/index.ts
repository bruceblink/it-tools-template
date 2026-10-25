import { SortAscendingLetters } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/json-key-sorter',
  categoryId: 'development',
  translationKey: 'json-key-sorter',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  name: translate('tools.json-key-sorter.title'),
  path: '/json-key-sorter',
  description: translate('tools.json-key-sorter.description'),
  keywords: ['json', 'sort', 'keys', 'stable'],
  component: () => loadBuiltinToolComponent('json-key-sorter/json-key-sorter.vue'),
  icon: SortAscendingLetters,
  createdAt: new Date('2026-06-08'),
});

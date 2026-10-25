import { CompareArrowsRound } from '@vicons/material';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/json-diff',
  categoryId: 'web',
  translationKey: 'json-diff',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  name: translate('tools.json-diff.title'),
  path: '/json-diff',
  description: translate('tools.json-diff.description'),
  keywords: ['json', 'diff', 'compare', 'difference', 'object', 'data'],
  component: () => loadBuiltinToolComponent('json-diff/json-diff.vue'),
  icon: CompareArrowsRound,
  createdAt: new Date('2023-04-20'),
});

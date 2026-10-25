import { FileDiff } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/text-diff',
  categoryId: 'text',
  translationKey: 'text-diff',
  name: translate('tools.text-diff.title'),
  path: '/text-diff',
  description: translate('tools.text-diff.description'),
  keywords: ['text', 'diff', 'compare', 'string', 'text diff', 'code'],
  component: () => loadBuiltinToolComponent('text-diff/text-diff.vue'),
  icon: FileDiff,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2023-08-16'),
});

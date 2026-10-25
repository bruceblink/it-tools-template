import { BrandJavascript } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/regex-memo',
  categoryId: 'development',
  translationKey: 'regex-memo',
  platforms: ['web', 'electron'],
  dataProcessing: 'local-data',
  offline: 'available',
  capabilities: [],
  name: translate('tools.regex-memo.title'),
  path: '/regex-memo',
  description: translate('tools.regex-memo.description'),
  keywords: ['regex', 'regular', 'expression', 'javascript', 'memo', 'cheatsheet'],
  component: () => loadBuiltinToolComponent('regex-memo/regex-memo.vue'),
  icon: BrandJavascript,
  createdAt: new Date('2024-09-20'),
});

import { Language } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/regex-tester',
  categoryId: 'development',
  translationKey: 'regex-tester',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  name: translate('tools.regex-tester.title'),
  path: '/regex-tester',
  description: translate('tools.regex-tester.description'),
  keywords: ['regex', 'tester', 'sample', 'expression', 'matches', 'captures', 'groups'],
  component: () => loadBuiltinToolComponent('regex-tester/regex-tester.vue'),
  icon: Language,
  createdAt: new Date('2024-09-20'),
});

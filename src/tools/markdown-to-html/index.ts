import { Markdown } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/markdown-to-html',
  categoryId: 'converter',
  translationKey: 'markdown-to-html',
  name: translate('tools.markdown-to-html.title'),
  path: '/markdown-to-html',
  description: translate('tools.markdown-to-html.description'),
  keywords: ['markdown', 'html', 'converter', 'pdf'],
  component: () => loadBuiltinToolComponent('markdown-to-html/markdown-to-html.vue'),
  icon: Markdown,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2024-08-25'),
});

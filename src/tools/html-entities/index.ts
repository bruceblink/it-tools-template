import { Code } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/html-entities',
  categoryId: 'web',
  translationKey: 'html-entities',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.html-entities.title'),
  path: '/html-entities',
  description: translate('tools.html-entities.description'),
  keywords: ['html', 'entities', 'escape', 'unescape', 'special', 'characters', 'tags'],
  component: () => loadBuiltinToolComponent('html-entities/html-entities.vue'),
  icon: Code,
});

import { Braces } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/json-minify',
  categoryId: 'development',
  translationKey: 'json-minify',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  name: translate('tools.json-minify.title'),
  path: '/json-minify',
  description: translate('tools.json-minify.description'),
  keywords: ['json', 'minify', 'format'],
  component: () => loadBuiltinToolComponent('json-minify/json-minify.vue'),
  icon: Braces,
});

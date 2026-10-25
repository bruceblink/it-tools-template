import { ArrowsShuffle } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/token-generator',
  categoryId: 'crypto',
  translationKey: 'token-generator',
  name: translate('tools.token-generator.title'),
  path: '/token-generator',
  description: translate('tools.token-generator.description'),
  keywords: ['token', 'random', 'string', 'alphanumeric', 'symbols', 'number', 'letters', 'lowercase', 'uppercase', 'password', 'entropy', 'alphabet', 'search-space'],
  component: () => loadBuiltinToolComponent('token-generator/token-generator.tool.vue'),
  icon: ArrowsShuffle,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
});

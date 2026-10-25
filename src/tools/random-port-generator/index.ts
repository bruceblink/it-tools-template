import { Server } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/random-port-generator',
  categoryId: 'development',
  translationKey: 'random-port-generator',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.random-port-generator.title'),
  path: '/random-port-generator',
  description: translate('tools.random-port-generator.description'),
  keywords: ['system', 'port', 'lan', 'generator', 'random', 'development', 'computer', 'registered', 'dynamic', 'range'],
  component: () => loadBuiltinToolComponent('random-port-generator/random-port-generator.vue'),
  icon: Server,
});

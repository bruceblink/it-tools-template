import { Braces } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/json-to-yaml-converter',
  categoryId: 'converter',
  translationKey: 'json-to-yaml-converter',
  name: translate('tools.json-to-yaml-converter.title'),
  path: '/json-to-yaml-converter',
  description: translate('tools.json-to-yaml-converter.description'),
  keywords: ['yaml', 'to', 'json'],
  component: () => loadBuiltinToolComponent('json-to-yaml-converter/json-to-yaml.vue'),
  icon: Braces,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2023-04-10'),
});

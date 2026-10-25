import { Braces } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/xml-to-json',
  categoryId: 'converter',
  translationKey: 'xml-to-json',
  name: translate('tools.xml-to-json.title'),
  path: '/xml-to-json',
  description: translate('tools.xml-to-json.description'),
  keywords: ['xml', 'json'],
  component: () => loadBuiltinToolComponent('xml-to-json/xml-to-json.vue'),
  icon: Braces,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2024-08-09'),
});

import { FileDigit } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/data-size-converter',
  categoryId: 'measurement',
  translationKey: 'data-size-converter',
  name: translate('tools.data-size-converter.title'),
  path: '/data-size-converter',
  description: translate('tools.data-size-converter.description'),
  keywords: ['data', 'size', 'byte', 'bit', 'convert'],
  component: () => loadBuiltinToolComponent('data-size-converter/data-size-converter.vue'),
  icon: FileDigit,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2026-06-08'),
});

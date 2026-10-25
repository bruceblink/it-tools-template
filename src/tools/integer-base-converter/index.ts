import { ArrowsLeftRight } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/base-converter',
  categoryId: 'converter',
  translationKey: 'base-converter',
  name: translate('tools.base-converter.title'),
  path: '/base-converter',
  description: translate('tools.base-converter.description'),
  keywords: ['integer', 'number', 'base', 'conversion', 'decimal', 'hexadecimal', 'binary', 'octal', 'base64'],
  component: () => loadBuiltinToolComponent('integer-base-converter/integer-base-converter.vue'),
  icon: ArrowsLeftRight,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
});

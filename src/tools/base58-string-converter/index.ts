import { FileDigit } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/base58-string-converter',
  categoryId: 'converter',
  translationKey: 'base58-string-converter',
  name: translate('tools.base58-string-converter.title'),
  path: '/base58-string-converter',
  description: translate('tools.base58-string-converter.description'),
  keywords: ['base58', 'converter', 'conversion', 'encoding', 'decode', 'bitcoin', 'flickr', 'base-x', 'summary', 'bytes', 'length'],
  component: () => loadBuiltinToolComponent('base58-string-converter/base58-string-converter.vue'),
  icon: FileDigit,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2026-07-04'),
});

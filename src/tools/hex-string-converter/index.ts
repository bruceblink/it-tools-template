import { Binary } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/hex-string-converter',
  categoryId: 'converter',
  translationKey: 'hex-string-converter',
  name: translate('tools.hex-string-converter.title'),
  path: '/hex-string-converter',
  description: translate('tools.hex-string-converter.description'),
  keywords: ['hex', 'hexadecimal', 'string', 'converter', 'encode', 'decode', 'utf8', 'bytes', 'summary', 'length'],
  component: () => loadBuiltinToolComponent('hex-string-converter/hex-string-converter.vue'),
  icon: Binary,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2026-07-04'),
});

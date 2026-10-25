import { FileDigit } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/base32-string-converter',
  categoryId: 'converter',
  translationKey: 'base32-string-converter',
  name: translate('tools.base32-string-converter.title'),
  path: '/base32-string-converter',
  description: translate('tools.base32-string-converter.description'),
  keywords: ['base32', 'converter', 'conversion', 'encoding', 'decode', 'totp', 'secret', 'rfc4648', 'summary', 'bytes', 'length', 'padding'],
  component: () => loadBuiltinToolComponent('base32-string-converter/base32-string-converter.vue'),
  icon: FileDigit,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2026-07-03'),
});

import { FileDigit } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/base64-string-converter',
  categoryId: 'converter',
  translationKey: 'base64-string-converter',
  name: translate('tools.base64-string-converter.title'),
  path: '/base64-string-converter',
  description: translate('tools.base64-string-converter.description'),
  keywords: ['base64', 'converter', 'conversion', 'web', 'data', 'format', 'atob', 'btoa', 'summary', 'bytes', 'length', 'padding'],
  component: () => loadBuiltinToolComponent('base64-string-converter/base64-string-converter.vue'),
  icon: FileDigit,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  redirectFrom: ['/file-to-base64', '/base64-converter'],
});

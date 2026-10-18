import { FileDigit } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/base64-file-converter',
  categoryId: 'converter',
  translationKey: 'base64-file-converter',
  name: translate('tools.base64-file-converter.title'),
  path: '/base64-file-converter',
  description: translate('tools.base64-file-converter.description'),
  keywords: ['base64', 'converter', 'upload', 'image', 'file', 'conversion', 'web', 'data', 'format'],
  component: () => import('./base64-file-converter.vue'),
  icon: FileDigit,
  platforms: ['web', 'electron'],
  dataProcessing: 'user-selected-files',
  offline: 'available',
  capabilities: ['clipboard.write', 'file.read', 'file.save'],
});

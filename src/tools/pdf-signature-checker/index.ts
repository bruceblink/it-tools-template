import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';
import FileCertIcon from '~icons/mdi/file-certificate-outline';

export const tool = defineTool({
  id: 'builtin/pdf-signature-checker',
  categoryId: 'crypto',
  translationKey: 'pdf-signature-checker',
  name: translate('tools.pdf-signature-checker.title'),
  path: '/pdf-signature-checker',
  description: translate('tools.pdf-signature-checker.description'),
  keywords: ['pdf', 'signature', 'checker', 'verify', 'validate', 'sign'],
  component: () => loadBuiltinToolComponent('pdf-signature-checker/pdf-signature-checker.vue'),
  icon: FileCertIcon,
  createdAt: new Date('2023-12-09'),
  platforms: ['web', 'electron'],
  dataProcessing: 'user-selected-files',
  offline: 'available',
  capabilities: ['file.read'],
});

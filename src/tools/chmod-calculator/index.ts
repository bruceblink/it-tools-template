import { FileInvoice } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/chmod-calculator',
  categoryId: 'development',
  translationKey: 'chmod-calculator',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  name: translate('tools.chmod-calculator.title'),
  path: '/chmod-calculator',
  description: translate('tools.chmod-calculator.description'),
  keywords: [
    'chmod',
    'calculator',
    'file',
    'permission',
    'files',
    'directory',
    'folder',
    'recursive',
    'generator',
    'octal',
  ],
  component: () => loadBuiltinToolComponent('chmod-calculator/chmod-calculator.vue'),
  icon: FileInvoice,
});

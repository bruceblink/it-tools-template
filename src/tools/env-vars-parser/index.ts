import { Variable } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/env-vars-parser',
  categoryId: 'development',
  translationKey: 'env-vars-parser',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.env-vars-parser.title'),
  path: '/env-vars-parser',
  description: translate('tools.env-vars-parser.description'),
  keywords: ['env', 'dotenv', 'environment', 'variables', 'docker', 'compose', 'shell', 'export', 'json'],
  component: () => loadBuiltinToolComponent('env-vars-parser/env-vars-parser.vue'),
  icon: Variable,
  createdAt: new Date('2026-07-04'),
});

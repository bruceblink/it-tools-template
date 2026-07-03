import { Variable } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.env-vars-parser.title'),
  path: '/env-vars-parser',
  description: translate('tools.env-vars-parser.description'),
  keywords: ['env', 'dotenv', 'environment', 'variables', 'docker', 'compose', 'shell', 'export', 'json'],
  component: () => import('./env-vars-parser.vue'),
  icon: Variable,
  createdAt: new Date('2026-07-04'),
});

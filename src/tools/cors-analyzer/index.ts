import { ArrowsRightLeft } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.cors-analyzer.title'),
  path: '/cors-analyzer',
  description: translate('tools.cors-analyzer.description'),
  keywords: ['cors', 'http', 'headers', 'origin', 'preflight', 'access-control', 'credentials', 'score', 'grade'],
  component: () => import('./cors-analyzer.vue'),
  icon: ArrowsRightLeft,
  createdAt: new Date('2026-07-04'),
});

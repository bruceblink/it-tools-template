import { ShieldChevron } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.csp-analyzer.title'),
  path: '/csp-analyzer',
  description: translate('tools.csp-analyzer.description'),
  keywords: ['csp', 'content-security-policy', 'security', 'headers', 'script-src', 'frame-ancestors'],
  component: () => import('./csp-analyzer.vue'),
  icon: ShieldChevron,
  createdAt: new Date('2026-07-04'),
});

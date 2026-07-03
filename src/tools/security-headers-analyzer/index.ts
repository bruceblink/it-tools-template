import { ShieldCheck } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.security-headers-analyzer.title'),
  path: '/security-headers-analyzer',
  description: translate('tools.security-headers-analyzer.description'),
  keywords: ['http', 'headers', 'security', 'hsts', 'csp', 'x-frame-options', 'referrer-policy'],
  component: () => import('./security-headers-analyzer.vue'),
  icon: ShieldCheck,
  createdAt: new Date('2026-07-04'),
});

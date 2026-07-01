import { HttpRound } from '@vicons/material';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.http-headers-parser.title'),
  path: '/http-headers-parser',
  description: translate('tools.http-headers-parser.description'),
  keywords: ['http', 'headers', 'parser', 'request', 'response', 'curl'],
  component: () => import('./http-headers-parser.vue'),
  icon: HttpRound,
  createdAt: new Date('2026-07-01'),
});

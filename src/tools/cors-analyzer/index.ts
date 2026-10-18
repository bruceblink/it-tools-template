import { ArrowsRightLeft } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/cors-analyzer',
  extensionOwned: true,
  categoryId: 'web',
  translationKey: 'cors-analyzer',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.cors-analyzer.title'),
  path: '/cors-analyzer',
  description: translate('tools.cors-analyzer.description'),
  keywords: ['cors', 'http', 'headers', 'origin', 'preflight', 'access-control', 'credentials', 'score', 'grade', 'risk', 'summary'],
  component: () => import('./cors-analyzer.vue'),
  icon: ArrowsRightLeft,
  createdAt: new Date('2026-07-04'),
});

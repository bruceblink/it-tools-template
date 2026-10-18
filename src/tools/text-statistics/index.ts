import { FileText } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/text-statistics',
  categoryId: 'text',
  translationKey: 'text-statistics',
  name: translate('tools.text-statistics.title'),
  path: '/text-statistics',
  description: translate('tools.text-statistics.description'),
  keywords: ['text', 'statistics', 'length', 'characters', 'count', 'size', 'bytes'],
  component: () => import('./text-statistics.vue'),
  icon: FileText,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  redirectFrom: ['/text-stats'],
});

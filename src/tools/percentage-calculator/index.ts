import { Percentage } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/percentage-calculator',
  categoryId: 'math',
  translationKey: 'percentage-calculator',
  name: translate('tools.percentage-calculator.title'),
  path: '/percentage-calculator',
  description: translate('tools.percentage-calculator.description'),
  keywords: ['percentage', 'calculator', 'calculate', 'value', 'number', '%'],
  component: () => import('./percentage-calculator.vue'),
  icon: Percentage,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2023-06-18'),
});

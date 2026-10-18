import { Calendar } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/date-converter',
  categoryId: 'converter',
  translationKey: 'date-converter',
  name: translate('tools.date-converter.title'),
  path: '/date-converter',
  description: translate('tools.date-converter.description'),
  keywords: ['date', 'time', 'converter', 'iso', 'utc', 'timezone', 'year', 'month', 'day', 'minute', 'seconde'],
  component: () => import('./date-time-converter.vue'),
  icon: Calendar,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
});

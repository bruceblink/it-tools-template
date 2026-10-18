import { Alarm } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/crontab-generator',
  categoryId: 'development',
  translationKey: 'crontab-generator',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  name: translate('tools.crontab-generator.title'),
  path: '/crontab-generator',
  description: translate('tools.crontab-generator.description'),
  keywords: [
    'crontab',
    'generator',
    'cronjob',
    'cron',
    'schedule',
    'parse',
    'expression',
    'year',
    'month',
    'week',
    'day',
    'minute',
    'second',
  ],
  component: () => import('./crontab-generator.vue'),
  icon: Alarm,
});

import { SortAscendingLetters } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.json-key-sorter.title'),
  path: '/json-key-sorter',
  description: translate('tools.json-key-sorter.description'),
  keywords: ['json', 'sort', 'keys', 'stable'],
  component: () => import('./json-key-sorter.vue'),
  icon: SortAscendingLetters,
  createdAt: new Date('2026-06-08'),
});

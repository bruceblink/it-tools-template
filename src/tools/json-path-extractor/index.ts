import { Braces } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.json-path-extractor.title'),
  path: '/json-path-extractor',
  description: translate('tools.json-path-extractor.description'),
  keywords: ['json', 'path', 'extract', 'query'],
  component: () => import('./json-path-extractor.vue'),
  icon: Braces,
  createdAt: new Date('2026-06-08'),
});

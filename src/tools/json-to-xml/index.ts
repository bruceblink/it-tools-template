import { Braces } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/json-to-xml',
  categoryId: 'converter',
  translationKey: 'json-to-xml',
  name: translate('tools.json-to-xml.title'),
  path: '/json-to-xml',
  description: translate('tools.json-to-xml.description'),
  keywords: ['json', 'xml'],
  component: () => import('./json-to-xml.vue'),
  icon: Braces,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2024-08-09'),
});

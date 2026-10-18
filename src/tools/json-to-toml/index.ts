import { Braces } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/json-to-toml',
  categoryId: 'converter',
  translationKey: 'json-to-toml',
  name: translate('tools.json-to-toml.title'),
  path: '/json-to-toml',
  description: translate('tools.json-to-toml.description'),
  keywords: ['json', 'parse', 'toml', 'convert', 'transform'],
  component: () => import('./json-to-toml.vue'),
  icon: Braces,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2023-06-23'),
});

import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

import BracketIcon from '~icons/mdi/code-brackets';

export const tool = defineTool({
  id: 'builtin/toml-to-json',
  categoryId: 'converter',
  translationKey: 'toml-to-json',
  name: translate('tools.toml-to-json.title'),
  path: '/toml-to-json',
  description: translate('tools.toml-to-json.description'),
  keywords: ['toml', 'json', 'convert', 'online', 'transform', 'parser'],
  component: () => import('./toml-to-json.vue'),
  icon: BracketIcon,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2023-06-23'),
});

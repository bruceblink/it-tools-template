import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';
import BracketIcon from '~icons/mdi/code-brackets';

export const tool = defineTool({
  id: 'builtin/toml-to-yaml',
  categoryId: 'converter',
  translationKey: 'toml-to-yaml',
  name: translate('tools.toml-to-yaml.title'),
  path: '/toml-to-yaml',
  description: translate('tools.toml-to-yaml.description'),
  keywords: ['toml', 'yaml', 'convert', 'online', 'transform', 'parse'],
  component: () => loadBuiltinToolComponent('toml-to-yaml/toml-to-yaml.vue'),
  icon: BracketIcon,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2023-06-23'),
});

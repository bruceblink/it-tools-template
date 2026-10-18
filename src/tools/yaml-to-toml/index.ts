import { AlignJustified } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/yaml-to-toml',
  categoryId: 'converter',
  translationKey: 'yaml-to-toml',
  name: translate('tools.yaml-to-toml.title'),
  path: '/yaml-to-toml',
  description: translate('tools.yaml-to-toml.description'),
  keywords: ['yaml', 'to', 'toml', 'convert', 'transform'],
  component: () => import('./yaml-to-toml.vue'),
  icon: AlignJustified,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2023-06-23'),
});

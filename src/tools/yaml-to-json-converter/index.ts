import { AlignJustified } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/yaml-to-json-converter',
  categoryId: 'converter',
  translationKey: 'yaml-to-json-converter',
  name: translate('tools.yaml-to-json-converter.title'),
  path: '/yaml-to-json-converter',
  description: translate('tools.yaml-to-json-converter.description'),
  keywords: ['yaml', 'to', 'json'],
  component: () => import('./yaml-to-json.vue'),
  icon: AlignJustified,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  createdAt: new Date('2023-04-10'),
});

import { AlignJustified } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/yaml-prettify',
  categoryId: 'development',
  translationKey: 'yaml-prettify',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.yaml-prettify.title'),
  path: '/yaml-prettify',
  description: translate('tools.yaml-prettify.description'),
  keywords: ['yaml', 'viewer', 'prettify', 'format'],
  component: () => import('./yaml-viewer.vue'),
  icon: AlignJustified,
  createdAt: new Date('2024-01-31'),
});

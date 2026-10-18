import { Palette } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/color-converter',
  categoryId: 'converter',
  translationKey: 'color-converter',
  name: translate('tools.color-converter.title'),
  path: '/color-converter',
  description: translate('tools.color-converter.description'),
  keywords: ['color', 'converter'],
  component: () => import('./color-converter.vue'),
  icon: Palette,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  redirectFrom: ['/color-picker-converter'],
});

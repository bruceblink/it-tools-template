import { Ruler } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/length-converter',
  categoryId: 'measurement',
  translationKey: 'length-converter',
  name: translate('tools.length-converter.title'),
  path: '/length-converter',
  description: translate('tools.length-converter.description'),
  keywords: ['length', 'distance', 'meter', 'inch', 'convert'],
  component: () => import('./length-converter.vue'),
  icon: Ruler,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2026-06-08'),
});

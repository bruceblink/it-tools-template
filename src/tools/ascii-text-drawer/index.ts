import { Artboard } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/ascii-text-drawer',
  categoryId: 'text',
  translationKey: 'ascii-text-drawer',
  name: translate('tools.ascii-text-drawer.title'),
  path: '/ascii-text-drawer',
  description: translate('tools.ascii-text-drawer.description'),
  keywords: ['ascii', 'asciiart', 'text', 'drawer'],
  component: () => import('./ascii-text-drawer.vue'),
  icon: Artboard,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2024-03-03'),
});

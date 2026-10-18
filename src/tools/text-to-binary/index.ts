import { Binary } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/text-to-binary',
  categoryId: 'converter',
  translationKey: 'text-to-binary',
  name: translate('tools.text-to-binary.title'),
  path: '/text-to-binary',
  description: translate('tools.text-to-binary.description'),
  keywords: ['text', 'to', 'binary', 'converter', 'encode', 'decode', 'ascii'],
  component: () => import('./text-to-binary.vue'),
  icon: Binary,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2023-10-15'),
});

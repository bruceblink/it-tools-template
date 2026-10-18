import { TextWrap } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/text-to-unicode',
  categoryId: 'converter',
  translationKey: 'text-to-unicode',
  name: translate('tools.text-to-unicode.title'),
  path: '/text-to-unicode',
  description: translate('tools.text-to-unicode.description'),
  keywords: ['text', 'to', 'unicode'],
  component: () => import('./text-to-unicode.vue'),
  icon: TextWrap,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2024-01-31'),
});

import { FileDigit } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.data-size-converter.title'),
  path: '/data-size-converter',
  description: translate('tools.data-size-converter.description'),
  keywords: ['data', 'size', 'byte', 'bit', 'convert'],
  component: () => import('./data-size-converter.vue'),
  icon: FileDigit,
  createdAt: new Date('2026-06-08'),
});

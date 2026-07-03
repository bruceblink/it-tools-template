import { FileDigit } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.base58-string-converter.title'),
  path: '/base58-string-converter',
  description: translate('tools.base58-string-converter.description'),
  keywords: ['base58', 'converter', 'conversion', 'encoding', 'decode', 'bitcoin', 'flickr', 'base-x'],
  component: () => import('./base58-string-converter.vue'),
  icon: FileDigit,
  createdAt: new Date('2026-07-04'),
});

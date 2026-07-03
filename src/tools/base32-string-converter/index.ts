import { FileDigit } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.base32-string-converter.title'),
  path: '/base32-string-converter',
  description: translate('tools.base32-string-converter.description'),
  keywords: ['base32', 'converter', 'conversion', 'encoding', 'decode', 'totp', 'secret', 'rfc4648'],
  component: () => import('./base32-string-converter.vue'),
  icon: FileDigit,
  createdAt: new Date('2026-07-03'),
});

import { Binary } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  name: translate('tools.hex-string-converter.title'),
  path: '/hex-string-converter',
  description: translate('tools.hex-string-converter.description'),
  keywords: ['hex', 'hexadecimal', 'string', 'converter', 'encode', 'decode', 'utf8', 'bytes', 'summary', 'length'],
  component: () => import('./hex-string-converter.vue'),
  icon: Binary,
  createdAt: new Date('2026-07-04'),
});

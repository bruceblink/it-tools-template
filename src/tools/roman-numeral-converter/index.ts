import { LetterX } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/roman-numeral-converter',
  categoryId: 'converter',
  translationKey: 'roman-numeral-converter',
  name: translate('tools.roman-numeral-converter.title'),
  path: '/roman-numeral-converter',
  description: translate('tools.roman-numeral-converter.description'),
  keywords: ['roman', 'arabic', 'converter', 'X', 'I', 'V', 'L', 'C', 'D', 'M'],
  component: () => import('./roman-numeral-converter.vue'),
  icon: LetterX,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
});

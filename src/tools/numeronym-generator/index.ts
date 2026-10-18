import { defineTool } from '../tool';
import n7mIcon from './n7m-icon.svg?component';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/numeronym-generator',
  categoryId: 'text',
  translationKey: 'numeronym-generator',
  name: translate('tools.numeronym-generator.title'),
  path: '/numeronym-generator',
  description: translate('tools.numeronym-generator.description'),
  keywords: ['numeronym', 'generator', 'abbreviation', 'i18n', 'a11y', 'l10n'],
  component: () => import('./numeronym-generator.vue'),
  icon: n7mIcon,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2023-11-05'),
});

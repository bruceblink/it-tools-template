import { Speakerphone } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/text-to-nato-alphabet',
  categoryId: 'converter',
  translationKey: 'text-to-nato-alphabet',
  name: translate('tools.text-to-nato-alphabet.title'),
  path: '/text-to-nato-alphabet',
  description: translate('tools.text-to-nato-alphabet.description'),
  keywords: ['string', 'nato', 'alphabet', 'phonetic', 'oral', 'transmission'],
  component: () => loadBuiltinToolComponent('text-to-nato-alphabet/text-to-nato-alphabet.vue'),
  icon: Speakerphone,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
});

import { Phone } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/phone-parser-and-formatter',
  categoryId: 'data',
  translationKey: 'phone-parser-and-formatter',
  name: translate('tools.phone-parser-and-formatter.title'),
  path: '/phone-parser-and-formatter',
  description: translate('tools.phone-parser-and-formatter.description'),
  keywords: [
    'phone',
    'parser',
    'formatter',
    'validate',
    'format',
    'number',
    'telephone',
    'mobile',
    'cell',
    'international',
    'national',
  ],
  component: () => loadBuiltinToolComponent('phone-parser-and-formatter/phone-parser-and-formatter.vue'),
  icon: Phone,
  platforms: ['web', 'electron'],
  dataProcessing: 'local-data',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2023-05-01'),
});

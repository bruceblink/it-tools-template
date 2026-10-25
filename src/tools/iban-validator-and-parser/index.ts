import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';
import Bank from '~icons/mdi/bank';

export const tool = defineTool({
  id: 'builtin/iban-validator-and-parser',
  categoryId: 'data',
  translationKey: 'iban-validator-and-parser',
  name: translate('tools.iban-validator-and-parser.title'),
  path: '/iban-validator-and-parser',
  description: translate('tools.iban-validator-and-parser.description'),
  keywords: ['iban', 'validator', 'and', 'parser', 'bic', 'bank'],
  component: () => loadBuiltinToolComponent('iban-validator-and-parser/iban-validator-and-parser.vue'),
  icon: Bank,
  platforms: ['web', 'electron'],
  dataProcessing: 'local-data',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2023-08-26'),
});

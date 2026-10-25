import { AlignJustified } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/bip39-generator',
  categoryId: 'crypto',
  translationKey: 'bip39-generator',
  name: translate('tools.bip39-generator.title'),
  path: '/bip39-generator',
  description: translate('tools.bip39-generator.description'),
  keywords: ['BIP39', 'passphrase', 'generator', 'mnemonic', 'entropy'],
  component: () => loadBuiltinToolComponent('bip39-generator/bip39-generator.vue'),
  icon: AlignJustified,
  platforms: ['web', 'electron'],
  dataProcessing: 'local-data',
  offline: 'available',
  capabilities: ['clipboard.write'],
});

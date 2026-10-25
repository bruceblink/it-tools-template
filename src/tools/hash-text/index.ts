import { EyeOff } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/hash-text',
  categoryId: 'crypto',
  translationKey: 'hash-text',
  name: translate('tools.hash-text.title'),
  path: '/hash-text',
  description: translate('tools.hash-text.description'),
  keywords: [
    'hash',
    'digest',
    'digest size',
    'bit length',
    'crypto',
    'security',
    'text',
    'MD5',
    'SHA1',
    'SHA256',
    'SHA224',
    'SHA512',
    'SHA384',
    'SHA3',
    'RIPEMD160',
  ],
  component: () => loadBuiltinToolComponent('hash-text/hash-text.vue'),
  icon: EyeOff,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  redirectFrom: ['/hash'],
});

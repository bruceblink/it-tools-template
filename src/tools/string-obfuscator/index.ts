import { EyeOff } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/string-obfuscator',
  categoryId: 'text',
  translationKey: 'string-obfuscator',
  name: translate('tools.string-obfuscator.title'),
  path: '/string-obfuscator',
  description: translate('tools.string-obfuscator.description'),
  keywords: ['string', 'obfuscator', 'secret', 'token', 'hide', 'obscure', 'mask', 'masking'],
  component: () => import('./string-obfuscator.vue'),
  icon: EyeOff,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  createdAt: new Date('2023-08-16'),
});

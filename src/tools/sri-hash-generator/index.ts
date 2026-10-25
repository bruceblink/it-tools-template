import { ShieldLock } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/sri-hash-generator',
  categoryId: 'web',
  translationKey: 'sri-hash-generator',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.sri-hash-generator.title'),
  path: '/sri-hash-generator',
  description: translate('tools.sri-hash-generator.description'),
  keywords: ['sri', 'subresource integrity', 'hash', 'cdn', 'script', 'stylesheet', 'sha384', 'sha512', 'summary'],
  component: () => loadBuiltinToolComponent('sri-hash-generator/sri-hash-generator.vue'),
  icon: ShieldLock,
  createdAt: new Date('2026-07-04'),
});

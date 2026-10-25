import { Terminal2 } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/curl-code-generator',
  categoryId: 'development',
  translationKey: 'curl-code-generator',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.curl-code-generator.title'),
  path: '/curl-code-generator',
  description: translate('tools.curl-code-generator.description'),
  keywords: ['curl', 'fetch', 'axios', 'httpie', 'http', 'request', 'api', 'code', 'generator'],
  component: () => loadBuiltinToolComponent('curl-code-generator/curl-code-generator.vue'),
  icon: Terminal2,
  createdAt: new Date('2026-07-04'),
});

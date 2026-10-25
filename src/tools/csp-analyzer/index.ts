import { ShieldChevron } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/csp-analyzer',
  extensionOwned: true,
  categoryId: 'web',
  translationKey: 'csp-analyzer',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.csp-analyzer.title'),
  path: '/csp-analyzer',
  description: translate('tools.csp-analyzer.description'),
  keywords: ['csp', 'content-security-policy', 'security', 'headers', 'script-src', 'frame-ancestors', 'form-action'],
  component: () => loadBuiltinToolComponent('csp-analyzer/csp-analyzer.vue'),
  icon: ShieldChevron,
  createdAt: new Date('2026-07-04'),
});

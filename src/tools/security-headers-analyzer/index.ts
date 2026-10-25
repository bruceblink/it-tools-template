import { ShieldCheck } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/security-headers-analyzer',
  categoryId: 'web',
  translationKey: 'security-headers-analyzer',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.security-headers-analyzer.title'),
  path: '/security-headers-analyzer',
  description: translate('tools.security-headers-analyzer.description'),
  keywords: ['http', 'headers', 'security', 'hsts', 'csp', 'x-frame-options', 'referrer-policy', 'coop', 'coep', 'corp', 'recommended', 'remediation', 'server', 'x-powered-by'],
  component: () => loadBuiltinToolComponent('security-headers-analyzer/security-headers-analyzer.vue'),
  icon: ShieldCheck,
  createdAt: new Date('2026-07-04'),
});

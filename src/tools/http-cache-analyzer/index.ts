import { Clock } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/http-cache-analyzer',
  categoryId: 'web',
  translationKey: 'http-cache-analyzer',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.http-cache-analyzer.title'),
  path: '/http-cache-analyzer',
  description: translate('tools.http-cache-analyzer.description'),
  keywords: ['http', 'cache', 'headers', 'cache-control', 'etag', 'expires', 'date', 'age', 'freshness', 'vary', 'score', 'grade'],
  component: () => loadBuiltinToolComponent('http-cache-analyzer/http-cache-analyzer.vue'),
  icon: Clock,
  createdAt: new Date('2026-07-04'),
});

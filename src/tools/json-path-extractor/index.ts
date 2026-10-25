import { Braces } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/json-path-extractor',
  categoryId: 'development',
  translationKey: 'json-path-extractor',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.json-path-extractor.title'),
  path: '/json-path-extractor',
  description: translate('tools.json-path-extractor.description'),
  keywords: ['json', 'path', 'extract', 'query'],
  component: () => loadBuiltinToolComponent('json-path-extractor/json-path-extractor.vue'),
  icon: Braces,
  createdAt: new Date('2026-06-08'),
});

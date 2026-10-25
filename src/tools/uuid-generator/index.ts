import { Fingerprint } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/uuid-generator',
  categoryId: 'crypto',
  translationKey: 'uuid-generator',
  name: translate('tools.uuid-generator.title'),
  path: '/uuid-generator',
  description: translate('tools.uuid-generator.description'),
  keywords: ['uuid', 'v4', 'random', 'id', 'alphanumeric', 'identity', 'token', 'string', 'identifier', 'unique', 'v1', 'v3', 'v5', 'v7', 'nil'],
  component: () => loadBuiltinToolComponent('uuid-generator/uuid-generator.vue'),
  icon: Fingerprint,
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
});

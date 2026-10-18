import { Braces } from '@vicons/tabler';
import { defineTool } from '../tool';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/json-prettify',
  categoryId: 'development',
  translationKey: 'json-prettify',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: ['clipboard.write'],
  name: translate('tools.json-prettify.title'),
  path: '/json-prettify',
  description: translate('tools.json-prettify.description'),
  keywords: ['json', 'viewer', 'prettify', 'format'],
  component: () => import('./json-viewer.vue'),
  icon: Braces,
  redirectFrom: ['/json-viewer'],
});

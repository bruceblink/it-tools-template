import { Api } from '@vicons/tabler';
import { translate } from '@/plugins/i18n.plugin';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';

export const tool = defineTool({
  id: 'builtin/api-client',
  categoryId: 'development',
  translationKey: 'api-client',
  name: translate('tools.api-client.title'),
  path: '/api-client',
  description: translate('tools.api-client.description'),
  keywords: ['api', 'http', 'request', 'rest', 'response', 'headers'],
  component: () => loadBuiltinToolComponent('api-client/api-client.vue'),
  icon: Api,
  platforms: ['electron'],
  dataProcessing: 'network',
  offline: 'requires-network',
  capabilities: [],
  contentWidth: 'wide',
});

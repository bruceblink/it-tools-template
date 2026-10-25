import { Unlink } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/url-parser',
  categoryId: 'web',
  translationKey: 'url-parser',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  name: translate('tools.url-parser.title'),
  path: '/url-parser',
  description: translate('tools.url-parser.description'),
  keywords: ['url', 'parser', 'protocol', 'origin', 'params', 'query', 'duplicate', 'port', 'username', 'password', 'credentials', 'href', 'summary', 'segments'],
  component: () => loadBuiltinToolComponent('url-parser/url-parser.vue'),
  icon: Unlink,
});

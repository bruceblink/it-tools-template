import { Browser } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/user-agent-parser',
  categoryId: 'web',
  translationKey: 'user-agent-parser',
  platforms: ['web', 'electron'],
  dataProcessing: 'memory-only',
  offline: 'available',
  capabilities: [],
  name: translate('tools.user-agent-parser.title'),
  path: '/user-agent-parser',
  description: translate('tools.user-agent-parser.description'),
  keywords: ['user', 'agent', 'parser', 'browser', 'engine', 'os', 'cpu', 'device', 'user-agent', 'client'],
  component: () => loadBuiltinToolComponent('user-agent-parser/user-agent-parser.vue'),
  icon: Browser,
  createdAt: new Date('2023-04-06'),
});

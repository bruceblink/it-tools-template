import { Table } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/database-manager',
  categoryId: 'development',
  translationKey: 'database-manager',
  name: translate('tools.database-manager.title'),
  path: '/database-manager',
  description: translate('tools.database-manager.description'),
  keywords: ['database', 'postgresql', 'mysql', 'sqlite', 'sql', 'table', 'schema'],
  component: () => loadBuiltinToolComponent('database-manager/database-manager.vue'),
  icon: Table,
  platforms: ['electron'],
  dataProcessing: 'network',
  offline: 'conditional',
  capabilities: [],
  contentWidth: 'wide',
});

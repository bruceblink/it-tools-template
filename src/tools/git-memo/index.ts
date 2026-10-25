import { BrandGit } from '@vicons/tabler';
import { defineTool } from '../tool';
import { loadBuiltinToolComponent } from '../builtin-tool-component-loader';
import { translate } from '@/plugins/i18n.plugin';

export const tool = defineTool({
  id: 'builtin/git-memo',
  categoryId: 'development',
  translationKey: 'git-memo',
  platforms: ['web', 'electron'],
  dataProcessing: 'local-data',
  offline: 'available',
  capabilities: [],
  name: translate('tools.git-memo.title'),
  path: '/git-memo',
  description: translate('tools.git-memo.description'),
  keywords: ['git', 'push', 'force', 'pull', 'commit', 'amend', 'rebase', 'merge', 'reset', 'soft', 'hard', 'lease'],
  component: () => loadBuiltinToolComponent('git-memo/git-memo.vue'),
  icon: BrandGit,
});
